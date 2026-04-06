"use strict";

const fs = require("fs");
const fsProm = require("fs").promises;
const path = require("path");
const FormData = require("form-data");

function getSvdBaseUrl() {
  const u = process.env.VIDEO_SVD_BASE_URL || "http://188.124.55.89:5000";
  return String(u).replace(/\/$/, "");
}

/** POST /generate + model load can be slow; default 5 minutes (align with GPU SVD_GENERATION_TIMEOUT_SEC). */
function getPostTimeoutMs() {
  const a = Number(process.env.VIDEO_SVD_TIMEOUT_MS);
  const c = Number(process.env.VIDEO_SVD_POST_TIMEOUT_MS);
  const b = Number(process.env.VIDEO_SVD_TIMEOUT);
  if (Number.isFinite(a) && a > 0) return Math.floor(a);
  if (Number.isFinite(c) && c > 0) return Math.floor(c);
  if (Number.isFinite(b) && b > 0) return Math.floor(b);
  return 300_000;
}

function getDownloadTimeoutMs() {
  const a = Number(process.env.VIDEO_SVD_DOWNLOAD_TIMEOUT_MS);
  if (Number.isFinite(a) && a > 0) return Math.floor(a);
  return 300_000;
}

function getHealthTimeoutMs() {
  const a = Number(process.env.VIDEO_SVD_HEALTH_TIMEOUT_MS);
  if (Number.isFinite(a) && a > 0) return Math.floor(a);
  return 10_000;
}

/**
 * PNG/JPEG content-type for FastAPI validation (image/jpeg | image/png only).
 */
function guessImageContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "image/png";
}

/**
 * Fail fast if GPU SVD service is down.
 */
async function assertSvdGpuReady() {
  const base = getSvdBaseUrl();
  const healthUrl = `${base}/health`;
  const res = await fetch(healthUrl, {
    method: "GET",
    signal: AbortSignal.timeout(getHealthTimeoutMs()),
  });
  if (!res.ok) {
    throw new Error(`GPU unavailable: health HTTP ${res.status}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error("GPU unavailable: health check failed");
  }
}

/**
 * Stable Video Diffusion on GPU: POST image → GET MP4 (FastAPI /opt/svd/server.py).
 * @param {{ imagePath: string, outputPath: string }} opts
 */
async function generateSvdVideo({ imagePath, outputPath }) {
  const base = getSvdBaseUrl();
  const postTimeout = getPostTimeoutMs();
  const downloadTimeout = getDownloadTimeoutMs();

  if (!fs.existsSync(imagePath)) {
    throw new Error(`SVD: image not found: ${imagePath}`);
  }

  const form = new FormData();
  const filename = path.basename(imagePath) || "frame.png";
  form.append("file", fs.createReadStream(imagePath), {
    filename,
    contentType: guessImageContentType(imagePath),
  });

  const genUrl = `${base}/generate`;
  const res = await fetch(genUrl, {
    method: "POST",
    body: form,
    headers: form.getHeaders(),
    signal: AbortSignal.timeout(postTimeout),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`SVD: invalid JSON from GPU (${res.status}): ${text.slice(0, 400)}`);
  }

  if (!res.ok) {
    const d = data.detail;
    const msg =
      typeof d === "string"
        ? d
        : Array.isArray(d)
          ? JSON.stringify(d)
          : JSON.stringify(data);
    throw new Error(`SVD GPU HTTP ${res.status}: ${msg}`);
  }

  const videoId = data.video_id;
  if (!videoId || typeof videoId !== "string") {
    throw new Error(`SVD: missing video_id in response: ${JSON.stringify(data)}`);
  }

  const downloadUrl = `${base}/video/${encodeURIComponent(videoId)}`;
  const dl = await fetch(downloadUrl, {
    method: "GET",
    signal: AbortSignal.timeout(downloadTimeout),
  });

  if (!dl.ok) {
    const errBody = await dl.text().catch(() => "");
    throw new Error(`SVD download HTTP ${dl.status}: ${errBody.slice(0, 400)}`);
  }

  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length < 1000) {
    throw new Error("SVD: downloaded file too small (not a valid video?)");
  }

  await fsProm.mkdir(path.dirname(outputPath), { recursive: true });
  await fsProm.writeFile(outputPath, buf);
  return outputPath;
}

module.exports = {
  generateSvdVideo,
  getSvdBaseUrl,
  assertSvdGpuReady,
};
