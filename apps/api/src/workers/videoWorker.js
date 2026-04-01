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

/**
 * ControlNet Tile model for image2video: preserves composition of the reference frame.
 * Defaults to "" (disabled) — safe mode. Set VIDEO_CONTROLNET_TILE env to enable.
 * Typical filename: "control_v11f1e_sd15_tile.pth"
 */
const VIDEO_CONTROLNET_TILE = process.env.VIDEO_CONTROLNET_TILE || "";

// Animation sampling params (shared by both text2video pass-2 and image2video):
// denoise 0.25 → only adds motion, coherent base dominates
// cfg 5        → less creative deviation, fewer artifacts  
// steps 20     → fast enough, sufficient quality
const ANIM_DENOISE = 0.25;
const ANIM_CFG     = 5.0;
const ANIM_STEPS   = 20;

// Base image generation params (pass-1 txt2img):
const BASE_STEPS   = 20;
const BASE_CFG     = 7.0;

// Hard frame cap — AnimateDiff degrades badly above ~32 frames
const MAX_FRAMES   = 32;

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, deformed, ugly, watermark, text, out of focus, static, noise, distortion, morphing, shape change, color shift";

// ── AnimateDiff workflow builders ────────────────────────────────────────────

/**
 * text → video: 2-PASS pipeline.
 *
 * PASS 1 — txt2img (KSampler, denoise=1.0, cfg=7, steps=20):
 *   Generates a single coherent base image from the prompt.
 *   Uses the standard checkpoint without AnimateDiff (no motion model loaded yet).
 *
 * PASS 2 — img2anim (AnimateDiff KSampler, denoise=0.25, cfg=5, steps=20):
 *   Takes the base image latent, repeats it N times (frameCount),
 *   then AnimateDiff adds temporal motion while preserving structure.
 *
 * Result: no noise, stable objects, real coherent animation.
 *
 * Node graph:
 *   "1" CheckpointLoaderSimple
 *   "2" CLIPTextEncode (pos)
 *   "3" CLIPTextEncode (neg)
 *   "4" EmptyLatentImage (batch_size=1) — for pass-1 only
 *   "5" KSampler (pass-1: denoise=1.0) → base latent
 *   "6" RepeatLatentBatch (amount=frameCount)
 *   "7" ADE_AnimateDiffLoaderWithContext
 *   "8" KSampler (pass-2: denoise=0.25)
 *   "9" VAEDecode
 *   "10" VHS_VideoCombine
 *   "11" SaveImage (preview)
 */
function buildTextToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps }) {
  process.stdout.write(
    `[video:txt2vid] 2-pass: base(denoise=1.0 cfg=${BASE_CFG} steps=${BASE_STEPS}) → anim(denoise=${ANIM_DENOISE} cfg=${ANIM_CFG} steps=${ANIM_STEPS}) frames=${frameCount}\n`,
  );
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
    // Pass-1: single base image from empty latent
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        model:         ["1", 0],
        positive:      ["2", 0],
        negative:      ["3", 0],
        latent_image:  ["4", 0],
        seed:          Math.floor(Math.random() * 1e15),
        steps:         BASE_STEPS,
        cfg:           BASE_CFG,
        sampler_name:  "euler_ancestral",
        scheduler:     "karras",
        denoise:       1.0,
      },
    },
    // Pass-2: repeat base latent → AnimateDiff adds motion
    "6": {
      class_type: "RepeatLatentBatch",
      inputs: { samples: ["5", 0], amount: frameCount },
    },
    "7": {
      class_type: "ADE_AnimateDiffLoaderWithContext",
      inputs: {
        model:         ["1", 0],
        model_name:    VIDEO_MOTION_MOD,
        beta_schedule: VIDEO_BETA_SCHEDULE,
      },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model:         ["7", 0],
        positive:      ["2", 0],
        negative:      ["3", 0],
        latent_image:  ["6", 0],
        seed:          Math.floor(Math.random() * 1e15),
        steps:         ANIM_STEPS,
        cfg:           ANIM_CFG,
        sampler_name:  "euler_ancestral",
        scheduler:     "karras",
        denoise:       ANIM_DENOISE,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["1", 2] },
    },
    "10": {
      class_type: "VHS_VideoCombine",
      inputs: {
        images:          ["9", 0],
        frame_rate:      fps,
        loop_count:      0,
        filename_prefix: "vid_",
        format:          "video/h264-mp4",
        pingpong:        false,
        save_output:     true,
      },
    },
    "11": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "frame_", images: ["9", 0] },
    },
  };
}

/**
 * image → video: reference image → AnimateDiff with locked composition.
 *
 * Strategy:
 *  1. Low denoise (0.35) — KSampler only adds motion noise, original pixels dominate.
 *  2. ControlNet Tile (when VIDEO_CONTROLNET_TILE is set) — tiles the reference image
 *     as a structural guide per-frame, locking fine details and composition.
 *  3. cfg 5.5 / steps 25 — less creative deviation, smoother frames.
 *
 * Result: original image preserved, only subtle motion is added.
 */
function buildImageToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps, referenceFilename }) {
  const useTile = Boolean(VIDEO_CONTROLNET_TILE);

  process.stdout.write(
    `[video:img2vid] denoise=${ANIM_DENOISE} cfg=${ANIM_CFG} steps=${ANIM_STEPS} controlnet_tile=${useTile ? VIDEO_CONTROLNET_TILE : "disabled"}\n`,
  );

  const preservationNegative = [
    negativePrompt || "",
    "distortion, morphing, shape change, color shift, blur, artifacts, new objects, background change",
  ].filter(Boolean).join(", ");

  // ── base nodes (shared) ───────────────────────────────────────────────────
  const base = {
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
      inputs: { clip: ["1", 1], text: preservationNegative || DEFAULT_NEGATIVE },
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
  };

  if (useTile) {
    // ── WITH ControlNet Tile ──────────────────────────────────────────────────
    // Tile controlnet receives the scaled reference image as hint → locks structure
    // on every frame while AnimateDiff adds temporal motion.
    return {
      ...base,
      "8": {
        class_type: "ControlNetLoader",
        inputs: { control_net_name: VIDEO_CONTROLNET_TILE },
      },
      // Apply tile controlnet to the positive conditioning (strength 0.6 = structural guide, not rigid lock)
      "9": {
        class_type: "ControlNetApply",
        inputs: {
          conditioning:    ["2", 0],
          control_net:     ["8", 0],
          image:           ["5", 0],
          strength:        0.6,
        },
      },
      "10": {
        class_type: "ADE_AnimateDiffLoaderWithContext",
        inputs: {
          model:         ["1", 0],
          model_name:    VIDEO_MOTION_MOD,
          beta_schedule: VIDEO_BETA_SCHEDULE,
        },
      },
      "11": {
        class_type: "KSampler",
        inputs: {
          model:         ["10", 0],
          positive:      ["9", 0],   // controlnet-augmented conditioning
          negative:      ["3", 0],
          latent_image:  ["7", 0],
          seed:          Math.floor(Math.random() * 1e15),
          steps:         ANIM_STEPS,
          cfg:           ANIM_CFG,
          sampler_name:  "euler_ancestral",
          scheduler:     "karras",
          denoise:       ANIM_DENOISE,
        },
      },
      "12": {
        class_type: "VAEDecode",
        inputs: { samples: ["11", 0], vae: ["1", 2] },
      },
      "13": {
        class_type: "VHS_VideoCombine",
        inputs: {
          images:          ["12", 0],
          frame_rate:      fps,
          loop_count:      0,
          filename_prefix: "img2vid_",
          format:          "video/h264-mp4",
          pingpong:        false,
          save_output:     true,
        },
      },
      "14": {
        class_type: "SaveImage",
        inputs: { filename_prefix: "frame_", images: ["12", 0] },
      },
    };
  }

  // ── WITHOUT ControlNet (fallback) ─────────────────────────────────────────
  // Still much better than before: denoise 0.35 vs old 0.7
  return {
    ...base,
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
        steps:         ANIM_STEPS,
        cfg:           ANIM_CFG,
        sampler_name:  "euler_ancestral",
        scheduler:     "karras",
        denoise:       ANIM_DENOISE,
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

  // Cap frames at MAX_FRAMES — AnimateDiff degrades badly above 32 frames.
  // If duration * fps > MAX_FRAMES, reduce fps automatically.
  let finalFps = fps;
  let frameCount = Math.round(fps * duration);
  if (frameCount > MAX_FRAMES) {
    finalFps = Math.max(4, Math.floor(MAX_FRAMES / duration));
    frameCount  = Math.round(finalFps * duration);
    process.stdout.write(`[video:job] fps reduced ${fps}→${finalFps} to stay within MAX_FRAMES=${MAX_FRAMES}\n`);
  }
  frameCount = Math.max(8, Math.min(MAX_FRAMES, frameCount));

  process.stdout.write(`[video:job] job=${job.id} mode=${mode} frames=${frameCount} fps=${finalFps} duration=${duration}\n`);
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
    process.stdout.write(`[video:render] image2video — downloading reference from: ${imageUrl}\n`);
    const refBuf  = await downloadBuffer(imageUrl);
    const refFn   = await uploadToComfyUI(refBuf, `ref_${finalJobId}.png`);
    workflow = buildImageToVideoWorkflow({
      prompt, negativePrompt, width, height, frameCount, fps: finalFps,
      referenceFilename: refFn,
    });
  } else {
    workflow = buildTextToVideoWorkflow({ prompt, negativePrompt, width, height, frameCount, fps: finalFps });
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
  const actualDuration = frameCount / finalFps;
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
    fps: finalFps,
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
