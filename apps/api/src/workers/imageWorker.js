"use strict";

require("dotenv").config();

const { Worker } = require("bullmq");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getWorkerConnection } = require("../lib/redis");

const COMFYUI_URL = process.env.COMFYUI_URL || "http://188.124.55.89:8188";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";
const PUBLIC_BASE = process.env.IMAGE_PUBLIC_BASE || "https://site-al.ru/uploads/images";

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, extra limbs, extra objects, distorted, watermark, text, ugly, deformed, out of focus, overexposed";

// SDXL workflow template
function buildWorkflow(prompt, width = 1024, height = 1024, negativePrompt) {
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
      inputs: { batch_size: 1, height, width },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: prompt,
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["4", 1],
        text: negativePrompt || DEFAULT_NEGATIVE,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "img_",
        images: ["8", 0],
      },
    },
  };
}

/**
 * Poll ComfyUI until the prompt finishes or times out.
 * Returns array of output filenames.
 * @param {string} promptId
 * @param {number} timeoutMs
 * @returns {Promise<string[]>}
 */
async function waitForComfyOutput(promptId, timeoutMs = 120_000) {
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
    if (!entry) continue; // still queued / running

    const { status, outputs } = entry;

    // Only throw on explicit error (not while executing/queued)
    if (status?.status_str === "error") {
      const msgs = (status?.messages || [])
        .filter((m) => m[0] === "execution_error")
        .map((m) => {
          const d = m[1];
          if (d && typeof d === "object") {
            return d.exception_message || d.message || JSON.stringify(d).slice(0, 300);
          }
          return String(d);
        })
        .join("; ");
      throw new Error(`ComfyUI error: ${msgs || "unknown"}`);
    }

    // Find image outputs (present when status = "success")
    const files = [];
    for (const nodeOut of Object.values(outputs || {})) {
      for (const img of nodeOut.images || []) {
        if (img.filename) files.push(img.filename);
      }
    }
    if (files.length > 0) return files;
  }
  throw new Error("ComfyUI generation timed out (120s)");
}

/**
 * Download a generated image from ComfyUI and save to disk.
 * @param {string} filename  ComfyUI output filename
 * @param {string} jobId     used as prefix for saved file
 * @returns {Promise<{localPath: string, publicUrl: string}>}
 */
async function saveImage(filename, jobId) {
  const url = `${COMFYUI_URL}/view?filename=${encodeURIComponent(filename)}&type=output`;
  const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30_000 });

  const ext = path.extname(filename) || ".png";
  const savedName = `${jobId}${ext}`;
  const localPath = path.join(OUTPUT_DIR, savedName);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(localPath, Buffer.from(res.data));

  return { localPath, publicUrl: `${PUBLIC_BASE}/${savedName}` };
}

// ── Worker ──────────────────────────────────────────────────────────────────

const worker = new Worker(
  "image-generation",
  async (job) => {
    const { prompt, negativePrompt, width = 1024, height = 1024, jobId } = job.data;
    job.log(`[imageWorker] starting job=${job.id} prompt="${prompt.slice(0, 60)}"`);

    // 1. Check ComfyUI health
    await axios.get(`${COMFYUI_URL}/system_stats`, { timeout: 8000 }).catch(() => {
      throw new Error(`ComfyUI unreachable at ${COMFYUI_URL}`);
    });

    // 2. Submit workflow
    const workflow = buildWorkflow(prompt, width, height, negativePrompt);
    process.stdout.write(`[imageWorker] sending workflow to ComfyUI ${COMFYUI_URL}/prompt\n`);
    let queueData;
    try {
      const res = await axios.post(
        `${COMFYUI_URL}/prompt`,
        { prompt: workflow },
        { timeout: 15_000 }
      );
      queueData = res.data;
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
      throw new Error(`ComfyUI /prompt rejected: ${detail}`);
    }
    const promptId = queueData.prompt_id;
    if (!promptId) throw new Error(`ComfyUI did not return prompt_id. Response: ${JSON.stringify(queueData).slice(0, 200)}`);
    process.stdout.write(`[imageWorker] ComfyUI accepted job, promptId=${promptId}\n`);
    job.log(`[imageWorker] queued promptId=${promptId}`);

    // 3. Poll until done
    const filenames = await waitForComfyOutput(promptId);
    job.log(`[imageWorker] generation done, files=${filenames.join(",")}`);

    // 4. Save first image
    const { localPath, publicUrl } = await saveImage(filenames[0], jobId || job.id);
    job.log(`[imageWorker] saved to ${localPath}`);

    return { url: publicUrl, localPath, promptId };
  },
  {
    connection: getWorkerConnection(),
    concurrency: 2,
  }
);

worker.on("completed", (job, result) => {
  process.stdout.write(`[imageWorker] job ${job.id} completed → ${result.url}\n`);
});
worker.on("failed", (job, err) => {
  process.stderr.write(`[imageWorker] job ${job?.id} failed: ${err.message}\n`);
});
worker.on("error", (err) => {
  process.stderr.write(`[imageWorker] worker error: ${err.message}\n`);
});

process.stdout.write(`[imageWorker] started. COMFYUI_URL=${COMFYUI_URL}\n`);
