"use strict";

require("dotenv").config();

const fs = require("fs");
const fsProm = require("fs").promises;
const os = require("os");
const path = require("path");
const { Worker } = require("bullmq");
const sharp = require("sharp");
const { getWorkerConnection } = require("../lib/redis");
const prisma = require("../lib/prisma");
const { fetchLtxVideoToFile } = require("../lib/videoLtx");
const { runComfyLtxToFile, assertComfyHasLtxNodes } = require("../lib/comfyLtxVideo");
const {
  ffmpegZoompanFromImage,
  mergeVideoVoice,
  mergeVideoVoiceMusic,
  mergeVideoSingleAudio,
  interpolateVideo,
  upscaleVideo2x,
} = require("../lib/videoCompose");
const { textToSpeechMp3 } = require("../lib/videoTts");

const OUTPUT_DIR = process.env.VIDEO_OUTPUT_DIR || "/var/www/site-al.ru/uploads/videos";
const PUBLIC_BASE = process.env.VIDEO_PUBLIC_BASE || "https://site-al.ru/uploads/videos";
const BG_MUSIC = process.env.VIDEO_BG_MUSIC_PATH || "";

function logPipeline(step, extra) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    step,
    svc: "videoWorker",
    ...extra,
  });
  process.stdout.write(`[VIDEO PIPELINE] ${line}\n`);
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsProm.writeFile(destPath, buf);
}

async function preprocessImage(inPath, outPath) {
  await sharp(inPath)
    .resize(1280, 720, { fit: "inside", withoutEnlargement: false })
    .sharpen({ sigma: 0.6 })
    .png()
    .toFile(outPath);
}

async function telegramSendVideo(token, chatId, publicUrl) {
  const TG = "https://api.telegram.org";
  const res = await fetch(`${TG}/bot${token}/sendVideo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      video: publicUrl,
      supports_streaming: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `sendVideo ${res.status}`);
  }
}

/**
 * Legacy path: HTTP LTX multipart or ffmpeg zoompan. Returns path to mp4 (ltxOut).
 */
async function runStandardVideoGeneration(prepImg, script, ltxOut, videoJobId) {
  logPipeline("ltx", { videoJobId });
  let usedLtx = false;
  try {
    usedLtx = await fetchLtxVideoToFile({
      imagePath: prepImg,
      script: String(script || ""),
      outMp4Path: ltxOut,
    });
  } catch (e) {
    process.stderr.write(`[VIDEO PIPELINE] ltx http error RAW: ${e.stack || e.message}\n`);
    usedLtx = false;
  }
  if (!usedLtx) {
    logPipeline("ltx_fallback", { videoJobId, note: "ffmpeg_zoompan" });
    await ffmpegZoompanFromImage(prepImg, ltxOut, 6);
  }
  return ltxOut;
}

const worker = new Worker(
  "video-generation",
  async (job) => {
    const {
      videoJobId,
      imageUrl,
      script,
      voiceText,
      notify,
      mode: modeRaw,
    } = job.data;

    const mode = modeRaw === "standard" ? "standard" : "ltx";

    const tmp = await fsProm.mkdtemp(path.join(os.tmpdir(), "vid-"));
    const rawImg = path.join(tmp, "in_raw");
    const prepImg = path.join(tmp, "in.png");
    const ltxOut = path.join(tmp, "ltx.mp4");
    const interpOut = path.join(tmp, "interp.mp4");
    const upscaleOut = path.join(tmp, "upscale.mp4");
    const voiceMp3 = path.join(tmp, "voice.mp3");
    const merged = path.join(tmp, "out.mp4");
    const finalName = `${videoJobId}.mp4`;
    const finalPath = path.join(OUTPUT_DIR, finalName);

    try {
      await prisma.videoGenerationJob.update({
        where: { id: videoJobId },
        data: { status: "processing" },
      });

      logPipeline("download", { videoJobId, mode });
      await downloadToFile(imageUrl, rawImg);

      logPipeline("preprocess", { videoJobId });
      await preprocessImage(rawImg, prepImg);

      let videoPath = ltxOut;

      if (mode === "ltx") {
        const allowLtxFallback = process.env.VIDEO_ALLOW_LTX_FALLBACK === "1";

        if (process.env.VIDEO_COMFY_VERIFY_LTX_NODES === "1") {
          try {
            await assertComfyHasLtxNodes();
          } catch (e) {
            throw new Error(String(e.message || e));
          }
        }

        logPipeline("ltx_generate", { videoJobId });
        let comfyOk = false;
        try {
          comfyOk = await runComfyLtxToFile({
            imagePath: prepImg,
            script: String(script || ""),
            outMp4Path: ltxOut,
          });
        } catch (e) {
          process.stderr.write(`[VIDEO PIPELINE] ltx_generate error RAW: ${e.stack || e.message}\n`);
          comfyOk = false;
        }

        if (comfyOk) {
          console.log("[VIDEO PIPELINE] USING COMFY LTX");
        } else if (allowLtxFallback) {
          console.log("[VIDEO PIPELINE] USING FALLBACK");
          logPipeline("ltx_generate_fallback", { videoJobId });
          await runStandardVideoGeneration(prepImg, script, ltxOut, videoJobId);
        } else {
          throw new Error(
            "ComfyUI LTX did not return a video. Required: (1) API workflow file at " +
              `${process.env.VIDEO_COMFY_LTX_API_WORKFLOW_PATH || "apps/api/comfy-workflows/ltx_image_to_video.api.json"} ` +
              "(Save API Format from ComfyUI with LoadImage, CLIPTextEncode, LTX nodes, SaveVideo/CreateVideo); " +
              "(2) ComfyUI-LTXVideo installed on GPU, models in place; " +
              "(3) reachable VIDEO_COMFY_URL. " +
              "Temporary zoom-only output: set VIDEO_ALLOW_LTX_FALLBACK=1 on video-worker."
          );
        }

        videoPath = ltxOut;

        if (process.env.VIDEO_LTX_INTERPOLATE !== "0") {
          logPipeline("interpolate", { videoJobId });
          try {
            await interpolateVideo(videoPath, interpOut);
            videoPath = interpOut;
          } catch (e) {
            process.stderr.write(`[VIDEO PIPELINE] interpolate fail RAW: ${e.stack || e.message}\n`);
            logPipeline("interpolate_skip", { videoJobId, err: String(e.message) });
          }
        }

        if (process.env.VIDEO_LTX_UPSCALE === "1") {
          logPipeline("upscale", { videoJobId });
          try {
            await upscaleVideo2x(videoPath, upscaleOut);
            videoPath = upscaleOut;
          } catch (e) {
            process.stderr.write(`[VIDEO PIPELINE] upscale fail RAW: ${e.stack || e.message}\n`);
            logPipeline("upscale_skip", { videoJobId, err: String(e.message) });
          }
        }
      } else {
        await runStandardVideoGeneration(prepImg, script, ltxOut, videoJobId);
        videoPath = ltxOut;
      }

      if (voiceText && String(voiceText).trim()) {
        logPipeline("audio", { videoJobId });
        try {
          await textToSpeechMp3(String(voiceText), voiceMp3);
          if (BG_MUSIC && fs.existsSync(BG_MUSIC)) {
            logPipeline("merge", { videoJobId, music: true });
            await mergeVideoVoiceMusic(videoPath, voiceMp3, BG_MUSIC, merged);
            videoPath = merged;
          } else {
            logPipeline("merge", { videoJobId, music: false });
            await mergeVideoVoice(videoPath, voiceMp3, merged);
            videoPath = merged;
          }
        } catch (e) {
          process.stderr.write(`[VIDEO PIPELINE] tts/merge fail RAW: ${e.stack || e.message}\n`);
          logPipeline("audio_skip", { videoJobId, err: String(e.message) });
        }
      } else if (BG_MUSIC && fs.existsSync(BG_MUSIC)) {
        logPipeline("merge_music_only", { videoJobId });
        await mergeVideoSingleAudio(videoPath, BG_MUSIC, merged);
        videoPath = merged;
      }

      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      await fsProm.copyFile(videoPath, finalPath);

      const outputUrl = `${PUBLIC_BASE.replace(/\/$/, "")}/${finalName}`;
      await prisma.videoGenerationJob.update({
        where: { id: videoJobId },
        data: { status: "completed", outputUrl, error: null },
      });

      logPipeline("complete", { videoJobId, outputUrl, mode });

      if (notify && notify.type === "telegram" && notify.token && notify.chatId != null) {
        try {
          await telegramSendVideo(notify.token, notify.chatId, outputUrl);
        } catch (e) {
          process.stderr.write(`[VIDEO PIPELINE] telegram notify RAW: ${e.stack || e.message}\n`);
        }
      }

      return { outputUrl };
    } catch (err) {
      process.stderr.write(`[VIDEO PIPELINE] failed RAW: ${err.stack || err.message}\n`);
      await prisma.videoGenerationJob.update({
        where: { id: videoJobId },
        data: { status: "failed", error: String(err.message || err).slice(0, 2000) },
      }).catch(() => {});
      throw err;
    } finally {
      await fsProm.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  },
  { connection: getWorkerConnection(), concurrency: 1 }
);

worker.on("completed", (job) => {
  process.stdout.write(`[videoWorker] job ${job.id} completed\n`);
});
worker.on("failed", (job, err) => {
  process.stderr.write(`[videoWorker] job ${job?.id} failed: ${err?.message}\n`);
});

process.stdout.write("[videoWorker] started. Queue video-generation\n");
