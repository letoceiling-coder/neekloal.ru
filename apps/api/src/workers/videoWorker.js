"use strict";

require("dotenv").config();

const { Worker } = require("bullmq");
const fs         = require("fs");
const path       = require("path");
const { v4: uuidv4 } = require("uuid");
const { getWorkerConnection } = require("../lib/redis");
const prisma = require("../lib/prisma");
const { MAX_VIDEO_CONCURRENCY, addDuration } = require("../lib/videoQueueMetrics");

// ── Config ──────────────────────────────────────────────────────────────────
const COMFYUI_VIDEO_URL = process.env.COMFYUI_VIDEO_URL || "http://188.124.55.89:8189";
/** ai-dock Caddy on ComfyUI requires Bearer WEB_TOKEN for :8188 (see /opt/ai-dock/etc/environment.sh in container) */
const COMFYUI_VIDEO_TOKEN = process.env.COMFYUI_VIDEO_TOKEN || "";

function comfyAuthHeaders(extra = {}) {
  const h = { ...extra };
  if (COMFYUI_VIDEO_TOKEN) {
    h.Authorization = `Bearer ${COMFYUI_VIDEO_TOKEN}`;
  }
  return h;
}

const OUTPUT_DIR   = process.env.VIDEO_OUTPUT_DIR   || "/var/www/site-al.ru/uploads/videos";
const PUBLIC_BASE  = process.env.VIDEO_PUBLIC_BASE  || "https://site-al.ru/uploads/videos";
const PREVIEW_DIR  = process.env.VIDEO_PREVIEW_DIR  || "/var/www/site-al.ru/uploads/videos/previews";
const PREVIEW_BASE = process.env.VIDEO_PREVIEW_BASE || "https://site-al.ru/uploads/videos/previews";

const VIDEO_CHECKPOINT  = process.env.VIDEO_CHECKPOINT   || "v1-5-pruned-emaonly.safetensors";
const VIDEO_MOTION_MOD  = process.env.VIDEO_MOTION_MODEL || "v3_sd15_mm.ckpt";
/** AnimateDiff Evolved beta schedule enum (must match node dropdown; e.g. autoselect) */
const VIDEO_BETA_SCHEDULE = process.env.VIDEO_BETA_SCHEDULE || "autoselect";

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, deformed, ugly, watermark, text, out of focus, static, noise";

// ── AnimateDiff workflow builders ────────────────────────────────────────────

/**
 * text → video: empty latent → AnimateDiff → VHS_VideoCombine
 */
function buildTextToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps }) {
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: VIDEO_CHECKPOINT },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: frameCount },
    },
    "5": {
      class_type: "ADE_AnimateDiffLoaderWithContext",
      inputs: {
        model:       ["1", 0],
        model_name:  VIDEO_MOTION_MOD,
        beta_schedule: VIDEO_BETA_SCHEDULE,
      },
    },
    "6": {
      class_type: "KSampler",
      inputs: {
        model:          ["5", 0],
        positive:       ["2", 0],
        negative:       ["3", 0],
        latent_image:   ["4", 0],
        seed:           Math.floor(Math.random() * 1e15),
        steps:          20,
        cfg:            7.0,
        sampler_name:   "euler",
        scheduler:      "normal",
        denoise:        1.0,
      },
    },
    "7": {
      class_type: "VAEDecode",
      inputs: { samples: ["6", 0], vae: ["1", 2] },
    },
    "8": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images:          ["7", 0],
        frame_rate:      fps,
        loop_count:      0,
        filename_prefix: "vid_",
        format:          "video/h264-mp4",
        pingpong:        false,
        save_output:     true,
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "frame_", images: ["7", 0] },
    },
  };
}

/**
 * image → video: reference image encoded to latent → AnimateDiff → VHS_VideoCombine
 * Uses partial denoising (denoise < 1.0) to keep subject from reference.
 */
function buildImageToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps, referenceFilename, strength }) {
  const denoise = Math.min(Math.max(Number(strength) || 0.7, 0.4), 0.95);
  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: VIDEO_CHECKPOINT },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: prompt },
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE },
    },
    "4": {
      class_type: "LoadImage",
      inputs: { image: referenceFilename, upload: "image" },
    },
    "5": {
      class_type: "ImageScale",
      inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" },
    },
    "6": {
      class_type: "VAEEncode",
      inputs: { pixels: ["5", 0], vae: ["1", 2] },
    },
    "7": {
      class_type: "RepeatLatentBatch",
      inputs: { samples: ["6", 0], amount: frameCount },
    },
    "8": {
      class_type: "ADE_AnimateDiffLoaderWithContext",
      inputs: {
        model:         ["1", 0],
        model_name:    VIDEO_MOTION_MOD,
        beta_schedule: VIDEO_BETA_SCHEDULE,
      },
    },
    "9": {
      class_type: "KSampler",
      inputs: {
        model:         ["8", 0],
        positive:      ["2", 0],
        negative:      ["3", 0],
        latent_image:  ["7", 0],
        seed:          Math.floor(Math.random() * 1e15),
        steps:         20,
        cfg:           7.0,
        sampler_name:  "euler",
        scheduler:     "normal",
        denoise,
      },
    },
    "10": {
      class_type: "VAEDecode",
      inputs: { samples: ["9", 0], vae: ["1", 2] },
    },
    "11": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images:          ["10", 0],
        frame_rate:      fps,
        loop_count:      0,
        filename_prefix: "img2vid_",
        format:          "video/h264-mp4",
        pingpong:        false,
        save_output:     true,
      },
    },
    "12": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "frame_", images: ["10", 0] },
    },
  };
}

// ── ComfyUI helpers ──────────────────────────────────────────────────────────

async function uploadToComfyUI(imageBuffer, filename) {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/png" });
  formData.append("image", blob, filename);

  const res = await fetch(`${COMFYUI_VIDEO_URL}/upload/image`, {
    method: "POST",
    headers: comfyAuthHeaders(),
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  process.stdout.write(`[videoWorker] uploaded ref to ComfyUI as: ${data.name}\n`);
  return data.name;
}

async function downloadBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function submitWorkflow(workflow) {
  let res;
  try {
    res = await fetch(`${COMFYUI_VIDEO_URL}/prompt`, {
      method:  "POST",
      headers: comfyAuthHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({ prompt: workflow }),
      signal:  AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`ComfyUI /prompt unreachable: ${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI /prompt rejected (${res.status}): ${text.slice(0, 300)}`);
  }
  const queueData = await res.json();
  const promptId = queueData.prompt_id;
  if (!promptId) throw new Error(`ComfyUI did not return prompt_id: ${JSON.stringify(queueData).slice(0, 200)}`);
  process.stdout.write(`[videoWorker] ComfyUI accepted job, promptId=${promptId}\n`);
  return promptId;
}

/**
 * Wait for ComfyUI to finish the job.
 * Returns { videoFiles: string[], imageFiles: string[] }
 * videoFiles → look in `gifs` (VHS_VideoCombine outputs)
 * imageFiles → look in `images` (SaveImage outputs = preview frames)
 */
async function waitForVideoOutput(promptId, totalFrames, onProgress, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));

    let history;
    try {
      const res = await fetch(`${COMFYUI_VIDEO_URL}/history/${promptId}`, {
        headers: comfyAuthHeaders(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) { continue; }
      history = await res.json();
    } catch (e) {
      process.stderr.write(`[videoWorker] poll error: ${e.message}\n`);
      continue;
    }

    const entry = history[promptId];
    if (!entry) continue;

    const { status, outputs } = entry;

    if (status?.status_str === "error") {
      const msgs = (status?.messages || [])
        .filter((m) => m[0] === "execution_error")
        .map((m) => {
          const d = m[1];
          if (d && typeof d === "object") return d.exception_message || d.message || JSON.stringify(d).slice(0, 300);
          return String(d);
        })
        .join("; ");
      throw new Error(`ComfyUI video error: ${msgs || "unknown"}`);
    }

    const videoFiles = [];
    const imageFiles = [];

    for (const nodeOut of Object.values(outputs || {})) {
      // VHS_VideoCombine outputs appear in `gifs` (even for mp4)
      for (const gif of nodeOut.gifs || []) {
        if (gif.filename) videoFiles.push({ filename: gif.filename, subfolder: gif.subfolder || "" });
      }
      // SaveImage outputs (preview frames)
      for (const img of nodeOut.images || []) {
        if (img.filename) imageFiles.push({ filename: img.filename, subfolder: img.subfolder || "" });
      }
    }

    const framesGenerated = imageFiles.length;
    if (typeof onProgress === "function" && totalFrames > 0) {
      const progress = Math.min(80, Math.round(10 + (framesGenerated / totalFrames) * 70));
      await onProgress(progress);
    }

    if (videoFiles.length > 0) {
      process.stdout.write(`[videoWorker] video ready: ${videoFiles.map(f => f.filename).join(", ")}\n`);
      return { videoFiles, imageFiles };
    }
  }
  throw new Error("ComfyUI video generation timed out (600s)");
}

async function downloadAndSaveFile(comfyFilename, subfolder, destPath, type = "output") {
  const url = `${COMFYUI_VIDEO_URL}/view?filename=${encodeURIComponent(comfyFilename)}&subfolder=${encodeURIComponent(subfolder)}&type=${type}`;
  const res = await fetch(url, {
    headers: comfyAuthHeaders(),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Failed to download ${comfyFilename} (${res.status})`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function processVideoJob(job) {
  const startTime = Date.now();
  const {
    prompt,
    negativePrompt,
    width    = 512,
    height   = 512,
    fps      = 8,
    duration = 2,
    mode     = "text",
    imageUrl,
    strength = 0.7,
    jobId,
    userId,
    organizationId,
  } = job.data;

  const finalJobId = jobId || job.id;
  const frameCount = Math.round(Math.min(Math.max(fps * duration, 8), 48));

  process.stdout.write(`[video:job] job=${job.id} mode=${mode} frames=${frameCount} fps=${fps}\n`);
  job.log(`[video:job] mode=${mode} frameCount=${frameCount} fps=${fps}`);
  await job.updateProgress(5);

  // Mark DB record as running
  await prisma.generatedVideo.updateMany({
    where: { jobId: finalJobId },
    data:  { status: "running" },
  }).catch(() => {});

  // Verify ComfyUI video engine is up
  try {
    const health = await fetch(`${COMFYUI_VIDEO_URL}/system_stats`, {
      headers: comfyAuthHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (e) {
    throw new Error(`ComfyUI video engine unreachable at ${COMFYUI_VIDEO_URL}: ${e.message}`);
  }
  await job.updateProgress(10);

  process.stdout.write(`[video:render] started — mode=${mode}\n`);
  job.log(`[video:render] started`);

  let workflow;

  if (mode === "image2video") {
    if (!imageUrl) throw new Error("imageUrl is required for image2video mode");
    process.stdout.write(`[video:render] image2video — downloading reference...\n`);
    const refBuf  = await downloadBuffer(imageUrl);
    const refFn   = await uploadToComfyUI(refBuf, `ref_${finalJobId}.png`);
    workflow = buildImageToVideoWorkflow({
      prompt, negativePrompt, width, height, frameCount, fps,
      referenceFilename: refFn, strength,
    });
  } else {
    workflow = buildTextToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps });
  }

  await job.updateProgress(10);
  const promptId = await submitWorkflow(workflow);
  process.stdout.write(`[video:render] ComfyUI promptId=${promptId}\n`);

  let lastProgress = 10;
  const { videoFiles, imageFiles } = await waitForVideoOutput(
    promptId,
    frameCount,
    async (p) => {
      if (p > lastProgress) {
        lastProgress = p;
        await job.updateProgress(p);
      }
    },
  );

  process.stdout.write(`[video:frames] count=${frameCount} videoFiles=${videoFiles.length} previewFrames=${imageFiles.length}\n`);
  job.log(`[video:frames] count=${frameCount}`);

  // ── Save video file ───────────────────────────────────────────────────────
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const vf       = videoFiles[0];
  const ext      = path.extname(vf.filename) || ".mp4";
  const savedName = `${finalJobId}${ext}`;
  const localPath = path.join(OUTPUT_DIR, savedName);
  await downloadAndSaveFile(vf.filename, vf.subfolder, localPath);
  const publicUrl = `${PUBLIC_BASE}/${savedName}`;

  process.stdout.write(`[video:done] saved video → ${localPath}\n`);
  await job.updateProgress(90);

  // ── Save preview frame (first frame from SaveImage nodes) ─────────────────
  let previewUrl  = null;
  let previewPath = null;

  if (imageFiles.length > 0) {
    try {
      fs.mkdirSync(PREVIEW_DIR, { recursive: true });
      const pf = imageFiles[0];
      const pExt = path.extname(pf.filename) || ".png";
      const previewName = `${finalJobId}${pExt}`;
      previewPath = path.join(PREVIEW_DIR, previewName);
      await downloadAndSaveFile(pf.filename, pf.subfolder, previewPath);
      previewUrl = `${PREVIEW_BASE}/${previewName}`;
      process.stdout.write(`[video:done] saved preview → ${previewPath}\n`);
    } catch (e) {
      process.stderr.write(`[videoWorker] preview save failed (non-fatal): ${e.message}\n`);
    }
  }

  // ── Update DB ─────────────────────────────────────────────────────────────
  const actualDuration = frameCount / fps;
  try {
    await prisma.generatedVideo.updateMany({
      where: { jobId: finalJobId },
      data: {
        status:      "completed",
        url:         publicUrl,
        localPath,
        previewUrl,
        previewPath,
        duration:    actualDuration,
        frameCount,
        completedAt: new Date(),
      },
    });
  } catch (e) {
    process.stderr.write(`[videoWorker] DB update failed: ${e.message}\n`);
  }

  job.log(`[video:done] saved url=${publicUrl}`);
  await job.updateProgress(100);
  addDuration(Date.now() - startTime);

  return {
    url: publicUrl,
    previewUrl,
    localPath,
    duration: actualDuration,
    frameCount,
    fps,
    mode,
  };
}

// ── Worker registration ───────────────────────────────────────────────────────

function startVideoWorker() {
  const { getVideoQueue } = require("../queues/videoQueue");
  const queueName = "video-generation";

  const worker = new Worker(queueName, processVideoJob, {
    connection:  getWorkerConnection(),
    concurrency: MAX_VIDEO_CONCURRENCY, // default 1; never > 2 (GPU safety)
    lockDuration: 660_000,  // 11 min lock — video generation takes long
  });

  worker.on("completed", (job, result) => {
    process.stdout.write(`[video:done] job ${job.id} completed → ${result.url}\n`);
  });

  worker.on("failed", (job, err) => {
    process.stderr.write(`[videoWorker] job ${job?.id} failed: ${err.message}\n`);
    if (job?.data?.jobId) {
      prisma.generatedVideo.updateMany({
        where: { jobId: job.data.jobId },
        data:  { status: "failed", errorMessage: err.message.slice(0, 500) },
      }).catch(() => {});
    }
  });

  worker.on("error", (err) => {
    process.stderr.write(`[videoWorker] worker error: ${err.message}\n`);
  });

  process.stdout.write(
    `[videoWorker] started. COMFYUI_VIDEO_URL=${COMFYUI_VIDEO_URL} auth=${COMFYUI_VIDEO_TOKEN ? "bearer" : "none"}\n`,
  );
  return worker;
}

module.exports = { startVideoWorker };

// Allow standalone execution: node workers/videoWorker.js
if (require.main === module) {
  startVideoWorker();
}
