"use strict";

require("dotenv").config();

const { Worker } = require("bullmq");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getWorkerConnection } = require("../lib/redis");
const prisma = require("../lib/prisma");

const COMFYUI_URL = process.env.COMFYUI_URL || "http://188.124.55.89:8188";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";
const PUBLIC_BASE = process.env.IMAGE_PUBLIC_BASE || "https://site-al.ru/uploads/images";

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, extra limbs, extra objects, distorted, watermark, text, ugly, deformed, out of focus, overexposed, underexposed, duplicate";

// ── Workflow builders ────────────────────────────────────────────────────────

function buildTextWorkflow(prompt, width = 1024, height = 1024, negativePrompt, batchSize = 1) {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        cfg: 7,
        denoise: 1,
        latent_image: ["5", 0],
        model: ["4", 0],
        negative: ["7", 0],
        positive: ["6", 0],
        sampler_name: "euler",
        scheduler: "normal",
        seed: Math.floor(Math.random() * 1e15),
        steps: 20,
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: batchSize, height, width },
    },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: prompt } },
    "7": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "img_", images: ["8", 0] } },
  };
}

function buildReferenceWorkflow(prompt, negativePrompt, width, height, strength, referenceFilename) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename, upload: "image" } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "KSampler",
      inputs: {
        cfg: 7, denoise: Math.min(Math.max(Number(strength) || 0.5, 0.1), 1.0),
        latent_image: ["6", 0], model: ["1", 0], negative: ["3", 0], positive: ["2", 0],
        sampler_name: "euler", scheduler: "normal", seed: Math.floor(Math.random() * 1e15), steps: 20,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["1", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "ref_", images: ["8", 0] } },
  };
}

/**
 * ControlNet workflow — uses comfyui_controlnet_aux preprocessors + SD1.5 ControlNet models.
 *
 * controlType: "canny" | "pose"
 * strength: 0.1–1.0 (ControlNet conditioning strength, default 0.8)
 *
 * Requires:
 *   - custom_nodes/comfyui_controlnet_aux
 *   - models/controlnet/control_v11p_sd15_canny.pth (for canny)
 *   - models/controlnet/control_v11p_sd15_openpose.pth (for pose)
 *   - models/checkpoints/v1-5-pruned-emaonly.safetensors (SD1.5 base)
 */
function buildControlNetWorkflow(prompt, negativePrompt, width, height, referenceFilename, controlType, strength) {
  const cnStrength = Math.min(Math.max(Number(strength) || 0.8, 0.1), 1.0);

  // Preprocessor node class varies by control type
  const preprocessorClass = controlType === "pose"
    ? "OpenposePreprocessor"
    : "CannyEdgePreprocessor";
  const preprocessorInputs = controlType === "pose"
    ? { image: ["4", 0], detect_hand: "enable", detect_body: "enable", detect_face: "enable", resolution: Math.min(width, height) }
    : { image: ["4", 0], low_threshold: 100, high_threshold: 200, resolution: Math.min(width, height) };

  const cnModelFile = controlType === "pose"
    ? "control_v11p_sd15_openpose.pth"
    : "control_v11p_sd15_canny.pth";

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" },
    },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename, upload: "image" } },
    "5": { class_type: preprocessorClass, inputs: preprocessorInputs },
    "6": {
      class_type: "ControlNetLoader",
      inputs: { control_net_name: cnModelFile },
    },
    "7": {
      class_type: "ControlNetApply",
      inputs: {
        conditioning: ["2", 0],
        control_net: ["6", 0],
        image: ["5", 0],
        strength: cnStrength,
      },
    },
    "8": {
      class_type: "EmptyLatentImage",
      inputs: { batch_size: 1, height, width },
    },
    "9": {
      class_type: "KSampler",
      inputs: {
        cfg: 7, denoise: 1,
        latent_image: ["8", 0], model: ["1", 0],
        negative: ["3", 0], positive: ["7", 0],
        sampler_name: "euler", scheduler: "normal",
        seed: Math.floor(Math.random() * 1e15), steps: 20,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": {
      class_type: "SaveImage",
      inputs: { filename_prefix: `cn_${controlType}_`, images: ["10", 0] },
    },
  };
}

function buildInpaintWorkflow(prompt, negativePrompt, width, height, referenceFilename, maskFilename) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename, upload: "image" } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "6": { class_type: "LoadImageMask", inputs: { image: maskFilename, channel: "red", upload: "image" } },
    "7": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["1", 2] } },
    "8": { class_type: "SetLatentNoiseMask", inputs: { samples: ["7", 0], mask: ["6", 0] } },
    "9": {
      class_type: "KSampler",
      inputs: {
        cfg: 7, denoise: 1.0,
        latent_image: ["8", 0], model: ["1", 0], negative: ["3", 0], positive: ["2", 0],
        sampler_name: "euler", scheduler: "normal", seed: Math.floor(Math.random() * 1e15), steps: 20,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "SaveImage", inputs: { filename_prefix: "inpaint_", images: ["10", 0] } },
  };
}

// ── ComfyUI helpers ──────────────────────────────────────────────────────────

async function uploadToComfyUI(imageBuffer, filename) {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/png" });
  formData.append("image", blob, filename);

  const res = await fetch(`${COMFYUI_URL}/upload/image`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  process.stdout.write(`[imageWorker] uploaded to ComfyUI as: ${data.name}\n`);
  return data.name;
}

async function downloadBuffer(url) {
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 20_000 });
  return Buffer.from(res.data);
}

async function submitWorkflow(workflow) {
  let queueData;
  try {
    const res = await axios.post(`${COMFYUI_URL}/prompt`, { prompt: workflow }, { timeout: 15_000 });
    queueData = res.data;
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    throw new Error(`ComfyUI /prompt rejected: ${detail}`);
  }
  const promptId = queueData.prompt_id;
  if (!promptId) throw new Error(`ComfyUI did not return prompt_id. Response: ${JSON.stringify(queueData).slice(0, 200)}`);
  process.stdout.write(`[imageWorker] ComfyUI accepted job, promptId=${promptId}\n`);
  return promptId;
}

async function waitForComfyOutput(promptId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));

    let history;
    try {
      const res = await axios.get(`${COMFYUI_URL}/history/${promptId}`, { timeout: 8000 });
      history = res.data;
    } catch (e) {
      process.stderr.write(`[imageWorker] poll error: ${e.message}\n`);
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
      throw new Error(`ComfyUI error: ${msgs || "unknown"}`);
    }

    const files = [];
    for (const nodeOut of Object.values(outputs || {})) {
      for (const img of nodeOut.images || []) {
        if (img.filename) files.push(img.filename);
      }
    }
    if (files.length > 0) return files;
  }
  throw new Error("ComfyUI generation timed out (180s)");
}

async function saveImageFile(filename, jobId, index = 0) {
  const url = `${COMFYUI_URL}/view?filename=${encodeURIComponent(filename)}&type=output`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });

  const ext = path.extname(filename) || ".png";
  const savedName = index === 0 ? `${jobId}${ext}` : `${jobId}_${index}${ext}`;
  const localPath = path.join(OUTPUT_DIR, savedName);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(localPath, Buffer.from(res.data));

  return { localPath, publicUrl: `${PUBLIC_BASE}/${savedName}` };
}

/**
 * Save all ComfyUI output images to disk + DB.
 * Returns array of { id, localPath, publicUrl } for each image.
 */
async function saveAllImages(filenames, jobData) {
  const {
    jobId, userId, organizationId,
    prompt, originalPrompt, negativePrompt,
    style, aspectRatio, mode,
    width = 1024, height = 1024,
  } = jobData;

  const results = [];
  for (let i = 0; i < filenames.length; i++) {
    const { localPath, publicUrl } = await saveImageFile(filenames[i], jobId, i);

    // Persist to DB (non-fatal: log and continue if fails)
    let dbId = uuidv4();
    try {
      const record = await prisma.generatedImage.create({
        data: {
          id: dbId,
          jobId,
          userId,
          organizationId,
          url: publicUrl,
          localPath,
          mode: mode || "text",
          prompt: prompt || "",
          originalPrompt: originalPrompt || null,
          negativePrompt: negativePrompt || null,
          style: style || null,
          aspectRatio: aspectRatio || null,
          width: Number(width) || 1024,
          height: Number(height) || 1024,
          variantIndex: i,
        },
      });
      dbId = record.id;
    } catch (e) {
      process.stderr.write(`[imageWorker] DB save failed for image ${i}: ${e.message}\n`);
    }

    results.push({ id: dbId, localPath, publicUrl });
  }
  return results;
}

// ── Worker ──────────────────────────────────────────────────────────────────

const worker = new Worker(
  "image-generation",
  async (job) => {
    const {
      prompt, negativePrompt, width = 1024, height = 1024, jobId,
      mode = "text", variations = 1, referenceImageUrl, strength = 0.5, maskUrl,
      controlType = "canny", style, aspectRatio,
    } = job.data;

    job.log(`[imageWorker] starting job=${job.id} mode=${mode} prompt="${prompt.slice(0, 60)}"`);
    process.stdout.write(`[imageWorker] job ${job.id} mode=${mode}\n`);

    await axios.get(`${COMFYUI_URL}/system_stats`, { timeout: 8000 }).catch(() => {
      throw new Error(`ComfyUI unreachable at ${COMFYUI_URL}`);
    });

    const finalJobId = jobId || job.id;
    const neg = negativePrompt || DEFAULT_NEGATIVE;

    let filenames;

    if (mode === "variation") {
      const batchSize = Math.min(Math.max(Number(variations) || 4, 1), 8);
      process.stdout.write(`[imageWorker] variation mode, batchSize=${batchSize}\n`);
      const workflow = buildTextWorkflow(prompt, width, height, neg, batchSize);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] variation done, files=${filenames.length}`);

    } else if (mode === "reference") {
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for reference mode");
      process.stdout.write(`[imageWorker] reference mode, downloading image...\n`);
      const buf = await downloadBuffer(referenceImageUrl);
      const comfyFn = await uploadToComfyUI(buf, `ref_${finalJobId}.png`);
      const workflow = buildReferenceWorkflow(prompt, neg, width, height, strength, comfyFn);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] reference done`);

    } else if (mode === "inpaint") {
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for inpaint mode");
      if (!maskUrl) throw new Error("maskUrl required for inpaint mode");
      process.stdout.write(`[imageWorker] inpaint mode, uploading images...\n`);
      const [refBuf, maskBuf] = await Promise.all([downloadBuffer(referenceImageUrl), downloadBuffer(maskUrl)]);
      const [refFn, maskFn] = await Promise.all([
        uploadToComfyUI(refBuf, `ref_${finalJobId}.png`),
        uploadToComfyUI(maskBuf, `mask_${finalJobId}.png`),
      ]);
      const workflow = buildInpaintWorkflow(prompt, neg, width, height, refFn, maskFn);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] inpaint done`);

    } else if (mode === "controlnet") {
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for controlnet mode");
      const validTypes = ["canny", "pose"];
      const resolvedType = validTypes.includes(controlType) ? controlType : "canny";
      process.stdout.write(`[imageWorker] controlnet mode, type=${resolvedType}, downloading input image...\n`);
      const buf = await downloadBuffer(referenceImageUrl);
      const comfyFn = await uploadToComfyUI(buf, `cn_${finalJobId}.png`);
      const workflow = buildControlNetWorkflow(prompt, neg, width, height, comfyFn, resolvedType, strength);
      process.stdout.write(`[imageWorker] submitting ControlNet workflow (${resolvedType})...\n`);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] controlnet done, files=${filenames.join(",")}`);

    } else {
      process.stdout.write(`[imageWorker] text mode, sending workflow\n`);
      const workflow = buildTextWorkflow(prompt, width, height, neg, 1);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] text done, files=${filenames.join(",")}`);
    }

    // Save to disk + DB
    const saved = await saveAllImages(filenames, {
      ...job.data,
      jobId: finalJobId,
    });

    job.log(`[imageWorker] saved ${saved.length} image(s)`);

    const urls = saved.map((s) => s.publicUrl);
    const localPaths = saved.map((s) => s.localPath);
    const dbIds = saved.map((s) => s.id);

    return { url: urls[0], urls, localPath: localPaths[0], localPaths, dbIds, mode, count: saved.length };
  },
  { connection: getWorkerConnection(), concurrency: 2 }
);

worker.on("completed", (job, result) => {
  process.stdout.write(`[imageWorker] job ${job.id} completed → ${result.urls.length} image(s)\n`);
  if (job.data?.pipelineId) {
    prisma.pipelineExecution.update({
      where:  { id: job.data.pipelineId },
      data:   { status: "completed", completedAt: new Date() },
    }).catch((e) => process.stderr.write(`[imageWorker] pipeline update failed: ${e.message}\n`));
  }
});
worker.on("failed", (job, err) => {
  process.stderr.write(`[imageWorker] job ${job?.id} failed: ${err.message}\n`);
  if (job?.data?.pipelineId) {
    prisma.pipelineExecution.update({
      where: { id: job.data.pipelineId },
      data:  { status: "failed" },
    }).catch(() => {});
  }
});
worker.on("error", (err) => {
  process.stderr.write(`[imageWorker] worker error: ${err.message}\n`);
});

process.stdout.write(`[imageWorker] started. COMFYUI_URL=${COMFYUI_URL}\n`);
