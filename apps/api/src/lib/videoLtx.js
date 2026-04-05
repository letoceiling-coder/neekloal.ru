"use strict";

const fs = require("fs").promises;
const path = require("path");

/**
 * GPU LTX / внешний сервис: POST multipart на VIDEO_LTX_ENDPOINT.
 * Ожидается ответ — тело MP4. Если env не задан — вернуть null (воркер использует ffmpeg-фолбэк).
 */
async function fetchLtxVideoToFile({ imagePath, script, outMp4Path }) {
  const endpoint = process.env.VIDEO_LTX_ENDPOINT || process.env.VIDEO_GPU_API_URL || "";
  if (!endpoint || !String(endpoint).startsWith("http")) {
    return false;
  }

  const prompt = `cinematic motion, ${script}, smooth camera movement`;
  const buf = await fs.readFile(imagePath);
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("image", new Blob([buf]), path.basename(imagePath));

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(Number(process.env.VIDEO_LTX_TIMEOUT_MS) || 600_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LTX HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  const ab = await res.arrayBuffer();
  await fs.writeFile(outMp4Path, Buffer.from(ab));
  return true;
}

module.exports = { fetchLtxVideoToFile };
