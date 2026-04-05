"use strict";

const fs = require("fs");
const fsProm = require("fs").promises;
const path = require("path");
const {
  uploadImageToComfy,
  submitPrompt,
  waitForComfyOutputs,
  downloadComfyView,
} = require("./comfyClient");

function getComfyBaseUrl() {
  const u = process.env.VIDEO_COMFY_URL || process.env.COMFYUI_URL || "http://188.124.55.89:8188";
  return String(u).replace(/\/$/, "");
}

function defaultWorkflowPath() {
  return path.join(__dirname, "../../comfy-workflows/ltx_image_to_video.api.json");
}

/**
 * Load API-format prompt graph. Supports { prompt: {...} } or top-level graph.
 */
function loadWorkflowPrompt(workflowPath) {
  const raw = fs.readFileSync(workflowPath, "utf8");
  const data = JSON.parse(raw);
  if (data.prompt && typeof data.prompt === "object") return { ...data.prompt };
  if (typeof data === "object" && !Array.isArray(data.nodes)) return { ...data };
  throw new Error("Workflow must be ComfyUI API JSON (object with node ids), not UI graph with nodes[]");
}

/**
 * Inject uploaded image name and text prompt into workflow.
 * - LoadImage: inputs.image
 * - CLIPTextEncode: inputs.text (positive — first match, or VIDEO_LTX_CLIP_POSITIVE_NODE_ID)
 */
function injectImageAndPrompt(promptGraph, imageFilename, script) {
  const text = `cinematic motion, ${script}, smooth camera movement`;
  const clipId = process.env.VIDEO_LTX_CLIP_POSITIVE_NODE_ID
    ? String(process.env.VIDEO_LTX_CLIP_POSITIVE_NODE_ID).trim()
    : "";

  let loadImageSet = false;
  for (const [, node] of Object.entries(promptGraph)) {
    if (!node || typeof node !== "object") continue;
    if (node.class_type === "LoadImage" && node.inputs) {
      node.inputs.image = imageFilename;
      loadImageSet = true;
      break;
    }
  }
  if (!loadImageSet) {
    for (const [, node] of Object.entries(promptGraph)) {
      if (!node || typeof node !== "object") continue;
      if (node.class_type === "LoadImage" && node.inputs) {
        node.inputs.image = imageFilename;
        loadImageSet = true;
      }
    }
  }

  let clipSet = false;
  if (clipId && promptGraph[clipId] && promptGraph[clipId].inputs) {
    if (promptGraph[clipId].inputs.text !== undefined) {
      promptGraph[clipId].inputs.text = text;
      clipSet = true;
    }
  }
  if (!clipSet) {
    const ids = Object.keys(promptGraph)
      .filter((k) => /^\d+$/.test(k))
      .map((k) => parseInt(k, 10))
      .sort((a, b) => a - b);
    for (const id of ids) {
      const node = promptGraph[String(id)];
      if (!node || node.class_type !== "CLIPTextEncode" || !node.inputs) continue;
      if (node.inputs.text !== undefined) {
        node.inputs.text = text;
        clipSet = true;
        break;
      }
    }
  }

  if (!loadImageSet) {
    throw new Error("No LoadImage node found in workflow");
  }
  if (!clipSet) {
    throw new Error("No CLIPTextEncode with inputs.text found (set VIDEO_LTX_CLIP_POSITIVE_NODE_ID)");
  }
}

/**
 * Run ComfyUI LTX I2V and write MP4 (or first video/gif output) to outMp4Path.
 * @returns {Promise<boolean>} true on success
 */
async function runComfyLtxToFile({ imagePath, script, outMp4Path }) {
  const workflowPath = process.env.VIDEO_COMFY_LTX_API_WORKFLOW_PATH || defaultWorkflowPath();
  if (!fs.existsSync(workflowPath)) {
    return false;
  }

  const baseUrl = getComfyBaseUrl();
  const buf = await fsProm.readFile(imagePath);
  const uploadName = `ltx_${Date.now()}_${path.basename(imagePath).replace(/[^a-zA-Z0-9._-]/g, "_")}.png`;

  let promptGraph;
  try {
    promptGraph = loadWorkflowPrompt(workflowPath);
    injectImageAndPrompt(promptGraph, uploadName, String(script || ""));
  } catch (e) {
    process.stderr.write(`[VIDEO PIPELINE] comfy workflow parse/inject: ${e.message}\n`);
    return false;
  }

  try {
    await uploadImageToComfy(baseUrl, buf, uploadName);
  } catch (e) {
    process.stderr.write(`[VIDEO PIPELINE] comfy upload: ${e.message}\n`);
    return false;
  }

  const timeoutMs = Number(process.env.VIDEO_COMFY_LTX_TIMEOUT_MS) || 600_000;

  try {
    const promptId = await submitPrompt(baseUrl, promptGraph);
    const { videos, images } = await waitForComfyOutputs(baseUrl, promptId, timeoutMs);

    const first = videos[0] || null;
    if (first) {
      await downloadComfyView(baseUrl, first, outMp4Path);
      return true;
    }

    if (images[0]) {
      process.stderr.write("[VIDEO PIPELINE] Comfy returned images, not video — LTX workflow may need SaveVideo\n");
    }
    return false;
  } catch (e) {
    process.stderr.write(`[VIDEO PIPELINE] comfy execute: ${e.stack || e.message}\n`);
    return false;
  }
}

module.exports = {
  runComfyLtxToFile,
  getComfyBaseUrl,
  defaultWorkflowPath,
};
