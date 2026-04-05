"use strict";

require("dotenv").config();

const { Worker } = require("bullmq");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getWorkerConnection } = require("../lib/redis");
const prisma = require("../lib/prisma");
const { enhanceProductProFile, buildCatalogProductPng } = require("../lib/productProPost");

const COMFYUI_URL = process.env.COMFYUI_URL || "http://188.124.55.89:8188";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";
const PUBLIC_BASE = process.env.IMAGE_PUBLIC_BASE || "https://site-al.ru/uploads/images";

/** SDXL IP-Adapter preset (ComfyUI_IPAdapter_plus). */
const IPADAPTER_PRESET = process.env.IMAGE_IPADAPTER_PRESET || "PLUS (high strength)";

let comfyNodeNameCache = null;
let comfyNodeNameCacheAt = 0;
const OBJECT_INFO_TTL_MS = 300_000;

async function getComfyNodeNames() {
  if (comfyNodeNameCache && Date.now() - comfyNodeNameCacheAt < OBJECT_INFO_TTL_MS) {
    return comfyNodeNameCache;
  }
  const res = await fetch(`${COMFYUI_URL}/object_info`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`object_info failed (${res.status})`);
  const data = await res.json();
  comfyNodeNameCache = new Set(Object.keys(data));
  comfyNodeNameCacheAt = Date.now();
  return comfyNodeNameCache;
}

function logGenLine(payload) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    svc: "imageWorker",
    ...payload,
  });
  process.stdout.write(`${line}\n`);
}

/** SDXL img2img denoise clamp — marketplace product band */
function clampRefDenoise(strength) {
  return Math.min(Math.max(Number(strength) || 0.45, 0.3), 0.6);
}

/** Product Pro model jobs — higher denoise for real pose/scene variation (API sends 0.65–0.75) */
function clampProductProDenoise(strength) {
  return Math.min(Math.max(Number(strength) || 0.7, 0.65), 0.75);
}

function clampIpAdapterWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 0.55;
  return Math.min(Math.max(n, 0.3), 0.8);
}

/** Product Pro: keep reference but allow more generation freedom (STEP 3) */
function clampProductProIpAdapterWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(Math.max(n, 0.4), 0.6);
}

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

function buildReferenceWorkflow(prompt, negativePrompt, width, height, denoise, referenceFilename) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "KSampler",
      inputs: {
        cfg: 7, denoise,
        latent_image: ["6", 0], model: ["1", 0], negative: ["3", 0], positive: ["2", 0],
        sampler_name: "euler", scheduler: "normal", seed: Math.floor(Math.random() * 1e15), steps: 20,
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["1", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "ref_", images: ["8", 0] } },
  };
}

/**
 * SDXL img2img + IP-Adapter (ComfyUI_IPAdapter_plus). Reference image drives identity/style;
 * latent from same image keeps garment structure. Requires IPAdapter + IPAdapterUnifiedLoader on ComfyUI.
 */
function buildProductIPAdapterWorkflow(prompt, negativePrompt, width, height, denoise, referenceFilename, ipWeight) {
  const weight = clampIpAdapterWeight(ipWeight);
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["1", 2] } },
    "7": {
      class_type: "IPAdapterUnifiedLoader",
      inputs: { model: ["1", 0], preset: IPADAPTER_PRESET },
    },
    "8": {
      class_type: "IPAdapter",
      inputs: {
        model: ["7", 0],
        ipadapter: ["7", 1],
        image: ["5", 0],
        weight,
        start_at: 0,
        end_at: 1,
        weight_type: "standard",
      },
    },
    "9": {
      class_type: "KSampler",
      inputs: {
        cfg: 7,
        denoise,
        latent_image: ["6", 0],
        model: ["8", 0],
        negative: ["3", 0],
        positive: ["2", 0],
        sampler_name: "euler",
        scheduler: "normal",
        seed: Math.floor(Math.random() * 1e15),
        steps: 25,
      },
    },
    "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
    "11": { class_type: "SaveImage", inputs: { filename_prefix: "product_ip_", images: ["10", 0] } },
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
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename } },
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

/**
 * Edit workflow — image-to-image editing that PRESERVES the source image.
 * Uses LoadImage → VAEEncode (not EmptyLatent) so the result modifies the input
 * rather than generating a completely new image.
 *
 * denoise=0.4 : keeps ~60% of the original, applies requested changes only
 * cfg=6       : balanced guidance
 * steps=25    : enough detail without over-processing
 *
 * Optional mask: if maskFilename is provided, only masked regions are edited
 * (SetLatentNoiseMask); unmasked areas are fully preserved.
 */
function buildEditWorkflow(prompt, negativePrompt, width, height, strength, referenceFilename, maskFilename = null) {
  const denoise = Math.min(Math.max(Number(strength) || 0.4, 0.1), 0.95);

  const base = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename } },
    "5": {
      class_type: "ImageScale",
      inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" },
    },
    "6": { class_type: "VAEEncode", inputs: { pixels: ["5", 0], vae: ["1", 2] } },
  };

  // With mask: edit only masked region, preserve the rest
  if (maskFilename) {
    return {
      ...base,
      "7":  { class_type: "LoadImageMask", inputs: { image: maskFilename, channel: "red" } },
      "8":  { class_type: "SetLatentNoiseMask", inputs: { samples: ["6", 0], mask: ["7", 0] } },
      "9":  {
        class_type: "KSampler",
        inputs: {
          cfg: 6, denoise, steps: 25,
          latent_image: ["8", 0], model: ["1", 0],
          negative: ["3", 0], positive: ["2", 0],
          sampler_name: "euler_ancestral", scheduler: "karras",
          seed: Math.floor(Math.random() * 1e15),
        },
      },
      "10": { class_type: "VAEDecode", inputs: { samples: ["9", 0], vae: ["1", 2] } },
      "11": { class_type: "SaveImage", inputs: { filename_prefix: "edit_masked_", images: ["10", 0] } },
    };
  }

  // Without mask: edit whole image with low denoise to preserve structure
  return {
    ...base,
    "7": {
      class_type: "KSampler",
      inputs: {
        cfg: 6, denoise, steps: 25,
        latent_image: ["6", 0], model: ["1", 0],
        negative: ["3", 0], positive: ["2", 0],
        sampler_name: "euler_ancestral", scheduler: "karras",
        seed: Math.floor(Math.random() * 1e15),
      },
    },
    "8": { class_type: "VAEDecode", inputs: { samples: ["7", 0], vae: ["1", 2] } },
    "9": { class_type: "SaveImage", inputs: { filename_prefix: "edit_", images: ["8", 0] } },
  };
}

function buildInpaintWorkflow(prompt, negativePrompt, width, height, referenceFilename, maskFilename) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: prompt } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negativePrompt || DEFAULT_NEGATIVE } },
    "4": { class_type: "LoadImage", inputs: { image: referenceFilename } },
    "5": { class_type: "ImageScale", inputs: { image: ["4", 0], width, height, upscale_method: "lanczos", crop: "disabled" } },
    "6": { class_type: "LoadImageMask", inputs: { image: maskFilename, channel: "red" } },
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
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function submitWorkflow(workflow) {
  let res;
  try {
    res = await fetch(`${COMFYUI_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: AbortSignal.timeout(15_000),
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
      const res = await fetch(`${COMFYUI_URL}/history/${promptId}`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) { continue; }
      history = await res.json();
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
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to download image ${filename} (${res.status})`);

  const ext = path.extname(filename) || ".png";
  const savedName = index === 0 ? `${jobId}${ext}` : `${jobId}_${index}${ext}`;
  const localPath = path.join(OUTPUT_DIR, savedName);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));

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

/**
 * Persist a buffer already in final form (e.g. catalog pipeline) + DB row.
 */
async function saveBufferAsGenerated(buffer, jobData, finalJobId) {
  const {
    userId, organizationId,
    prompt, originalPrompt, negativePrompt,
    style, aspectRatio, mode,
    width = 1024, height = 1024,
  } = jobData;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ext = ".png";
  const savedName = `${finalJobId}${ext}`;
  const localPath = path.join(OUTPUT_DIR, savedName);
  fs.writeFileSync(localPath, buffer);
  await enhanceProductProFile(localPath);

  const publicUrl = `${PUBLIC_BASE}/${savedName}`;
  let dbId = uuidv4();
  try {
    const record = await prisma.generatedImage.create({
      data: {
        id: dbId,
        jobId: finalJobId,
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
        variantIndex: 0,
      },
    });
    dbId = record.id;
  } catch (e) {
    process.stderr.write(`[imageWorker] DB save failed (buffer): ${e.message}\n`);
  }

  return { id: dbId, localPath, publicUrl };
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

    job.log(`[imageWorker] starting job=${job.id} mode=${mode} prompt="${String(prompt || "").slice(0, 60)}"`);
    process.stdout.write(`[imageWorker] job ${job.id} mode=${mode}\n`);

    await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(8_000) }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }).catch((e) => { throw new Error(`ComfyUI unreachable at ${COMFYUI_URL}: ${e.message}`); });

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
      const denoise = clampRefDenoise(strength);
      logGenLine({
        event: "image_gen_start",
        mode: "reference",
        jobId: String(finalJobId),
        referenceImageUrl: String(referenceImageUrl),
        denoise,
        ipAdapter: false,
        ipAdapterWeight: null,
        width, height,
      });
      process.stdout.write(`[imageWorker] reference mode, downloading image...\n`);
      const buf = await downloadBuffer(referenceImageUrl);
      const comfyFn = await uploadToComfyUI(buf, `ref_${finalJobId}.png`);
      const workflow = buildReferenceWorkflow(prompt, neg, width, height, denoise, comfyFn);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] reference done`);

    } else if (mode === "product_pro_catalog") {
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for product_pro_catalog");
      process.stdout.write(`[imageWorker] product_pro_catalog: rembg + white backdrop + sharpen\n`);
      const buf = await downloadBuffer(referenceImageUrl);
      const outBuf = await buildCatalogProductPng(buf);
      const saved = await saveBufferAsGenerated(outBuf, { ...job.data, jobId: finalJobId }, finalJobId);
      const urls = [saved.publicUrl];
      const localPaths = [saved.localPath];
      const dbIds = [saved.id];
      return {
        url: urls[0],
        urls,
        localPath: localPaths[0],
        localPaths,
        dbIds,
        mode,
        count: 1,
      };
    } else if (mode === "product" || mode === "product_pro_model") {
      // Product Pro model slots: SDXL + IP-Adapter (same as product). Pose variation is via prompt hints;
      // a unified SDXL+OpenPose ControlNet graph would need extra ComfyUI XL ControlNet wiring on the GPU host.
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for product mode");
      const denoise = mode === "product_pro_model"
        ? clampProductProDenoise(strength)
        : clampRefDenoise(strength);
      const ipW = mode === "product_pro_model"
        ? clampProductProIpAdapterWeight(job.data.ipAdapterWeight)
        : clampIpAdapterWeight(job.data.ipAdapterWeight);
      let hasIPAdapterNodes = false;
      try {
        const names = await getComfyNodeNames();
        hasIPAdapterNodes = names.has("IPAdapterUnifiedLoader") && names.has("IPAdapter");
        if (!hasIPAdapterNodes) {
          process.stdout.write("[IP-ADAPTER DISABLED — FALLBACK IMG2IMG]\n");
        }
      } catch (e) {
        hasIPAdapterNodes = false;
        process.stdout.write("[IP-ADAPTER DISABLED — FALLBACK IMG2IMG]\n");
        process.stderr.write(`[imageWorker] object_info failed (${e.message}), img2img only for product\n`);
      }

      const useIPAdapter = hasIPAdapterNodes;

      logGenLine({
        event: "image_gen_start",
        mode: mode === "product_pro_model" ? "product_pro_model" : "product",
        jobId: String(finalJobId),
        referenceImageUrl: String(referenceImageUrl),
        denoise,
        pose: mode === "product_pro_model" ? (job.data.productProPose ?? null) : undefined,
        ipAdapterWeight: ipW,
        hasIPAdapterNodes,
        useIPAdapter,
        workflowType: useIPAdapter ? "ip-adapter" : "img2img",
        width, height,
      });
      if (mode === "product_pro_model") {
        process.stdout.write(
          `[product_pro_model] pose=${job.data.productProPose ?? "?"} denoise=${denoise} ipAdapterWeight=${ipW}\n`
        );
      }

      process.stdout.write(`[imageWorker] product mode, useIPAdapter=${useIPAdapter}, downloading image...\n`);
      const buf = await downloadBuffer(referenceImageUrl);
      const comfyFn = await uploadToComfyUI(buf, `product_${finalJobId}.png`);

      const workflowType = useIPAdapter ? "ip-adapter" : "img2img";
      console.log("=== PRODUCT PIPELINE ===", {
        mode,
        hasIPAdapterNodes,
        useIPAdapter,
        ipAdapterWeight: ipW,
        referenceImageUrl: String(referenceImageUrl),
      });
      process.stdout.write(`[imageWorker] workflow type: ${workflowType}\n`);

      const workflow = useIPAdapter
        ? buildProductIPAdapterWorkflow(prompt, neg, width, height, denoise, comfyFn, ipW)
        : buildReferenceWorkflow(prompt, neg, width, height, denoise, comfyFn);
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] product done workflowType=${workflowType}`);

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

    } else if (mode === "edit") {
      // Image-to-image edit: preserves source image, applies only requested changes.
      // Uses VAEEncode (not EmptyLatent) + low denoise=0.4 to keep the original structure.
      if (!referenceImageUrl) throw new Error("referenceImageUrl required for edit mode");
      process.stdout.write(`[imageWorker] edit mode, strength=${strength}, hasMask=${!!maskUrl}\n`);

      const refBuf  = await downloadBuffer(referenceImageUrl);
      const refFn   = await uploadToComfyUI(refBuf, `edit_${finalJobId}.png`);

      let maskFn = null;
      if (maskUrl) {
        const maskBuf = await downloadBuffer(maskUrl);
        maskFn = await uploadToComfyUI(maskBuf, `mask_${finalJobId}.png`);
        process.stdout.write(`[imageWorker] edit mask uploaded: ${maskFn}\n`);
      }

      const workflow = buildEditWorkflow(prompt, neg, width, height, strength, refFn, maskFn);
      process.stdout.write(
        `[imageWorker] submitting edit workflow (denoise=${Math.min(Math.max(Number(strength) || 0.4, 0.1), 0.95)}, mask=${!!maskFn})...\n`
      );
      const promptId = await submitWorkflow(workflow);
      filenames = await waitForComfyOutput(promptId);
      job.log(`[imageWorker] edit done, files=${filenames.join(",")}`);

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

    if (mode === "product_pro_model") {
      for (const s of saved) {
        await enhanceProductProFile(s.localPath);
      }
    }

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
  logGenLine({
    event: "image_gen_failed",
    jobId: job?.id,
    mode: job?.data?.mode,
    referenceImageUrl: job?.data?.referenceImageUrl ? String(job.data.referenceImageUrl) : null,
    error: err.message,
    stack: err.stack ? String(err.stack).slice(0, 400) : undefined,
  });
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

getComfyNodeNames()
  .then((names) => {
    const hasIP = names.has("IPAdapter") && names.has("IPAdapterUnifiedLoader");
    if (!hasIP) process.stderr.write("IP-Adapter NOT INSTALLED — STOP\n");
    else process.stdout.write("[imageWorker] ComfyUI: IPAdapter + IPAdapterUnifiedLoader present\n");
  })
  .catch((e) => process.stderr.write(`[imageWorker] ComfyUI object_info check failed: ${e.message}\n`));
