#!/usr/bin/env node
/**
 * Audits ComfyUI text-to-image path (same graph as Telegram / imageWorker text mode).
 * Run on MAIN SERVER: cd apps/api && node scripts/e2e-comfy-text-audit.js
 * Exit 0 = image files produced; 1 = Comfy error; 2 = timeout.
 */
"use strict";

require("dotenv").config();

const COMFYUI_URL = (process.env.COMFYUI_URL || "http://188.124.55.89:8188").replace(/\/$/, "");

const wf = {
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
      seed: 424242,
      steps: 8,
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" } },
  "5": { class_type: "EmptyLatentImage", inputs: { batch_size: 1, height: 512, width: 512 } },
  "6": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "a simple red circle on white" } },
  "7": { class_type: "CLIPTextEncode", inputs: { clip: ["4", 1], text: "blurry, low quality" } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "e2e_audit_", images: ["8", 0] } },
};

async function main() {
  const stats = await fetch(`${COMFYUI_URL}/system_stats`, { signal: AbortSignal.timeout(15_000) });
  if (!stats.ok) {
    console.error("system_stats", stats.status);
    process.exit(1);
  }
  const pr = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf }),
    signal: AbortSignal.timeout(30_000),
  });
  const pj = await pr.json().catch(() => ({}));
  if (!pr.ok) {
    console.error("prompt rejected", pr.status, JSON.stringify(pj).slice(0, 500));
    process.exit(1);
  }
  const promptId = pj.prompt_id;
  if (!promptId) {
    console.error("no prompt_id", pj);
    process.exit(1);
  }
  console.log("prompt_id", promptId);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const hr = await fetch(`${COMFYUI_URL}/history/${promptId}`, { signal: AbortSignal.timeout(15_000) });
    if (!hr.ok) continue;
    const history = await hr.json();
    const entry = history[promptId];
    if (!entry) continue;

    if (entry.status?.status_str === "error") {
      const msgs = (entry.status?.messages || [])
        .filter((m) => m[0] === "execution_error")
        .map((m) => {
          const d = m[1];
          if (d && typeof d === "object") return d.exception_message || d.message || JSON.stringify(d);
          return String(d);
        })
        .join("; ");
      console.error("ComfyUI execution_error:", msgs || "unknown");
      process.exit(1);
    }

    const files = [];
    for (const nodeOut of Object.values(entry.outputs || {})) {
      for (const img of nodeOut.images || []) {
        if (img.filename) files.push(img.filename);
      }
    }
    if (files.length) {
      console.log("OK output files:", files.join(", "));
      process.exit(0);
    }
  }
  console.error("timeout waiting for outputs");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
