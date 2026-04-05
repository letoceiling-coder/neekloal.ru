"use strict";

/**
 * Minimal ComfyUI HTTP client (upload, /prompt, /history, /view).
 * Used by LTX video pipeline; mirrors patterns from imageWorker.js.
 */

async function uploadImageToComfy(baseUrl, imageBuffer, filename) {
  const formData = new FormData();
  const blob = new Blob([imageBuffer], { type: "image/png" });
  formData.append("image", blob, filename);

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.name;
}

async function submitPrompt(baseUrl, promptGraph, clientId = "video-ltx") {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ComfyUI /prompt (${res.status}): ${text.slice(0, 400)}`);
  }
  const queueData = await res.json();
  const promptId = queueData.prompt_id;
  if (!promptId) {
    throw new Error(`ComfyUI no prompt_id: ${JSON.stringify(queueData).slice(0, 200)}`);
  }
  return promptId;
}

/**
 * Poll history until we get output videos (preferred) or images.
 * @returns {{ videos: Array<{filename:string,subfolder?:string,type?:string}>, images: Array<...> }}
 */
async function waitForComfyOutputs(baseUrl, promptId, timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  const root = baseUrl.replace(/\/$/, "");

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));

    let history;
    try {
      const res = await fetch(`${root}/history/${promptId}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      history = await res.json();
    } catch {
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

    const videos = [];
    const images = [];
    for (const nodeOut of Object.values(outputs || {})) {
      if (!nodeOut || typeof nodeOut !== "object") continue;
      for (const v of nodeOut.videos || []) {
        if (v && v.filename) videos.push(v);
      }
      for (const im of nodeOut.images || []) {
        if (im && im.filename) images.push(im);
      }
      for (const g of nodeOut.gifs || []) {
        if (g && g.filename) videos.push(g);
      }
    }

    if (videos.length > 0 || images.length > 0) {
      return { videos, images };
    }
  }

  throw new Error(`ComfyUI timed out after ${timeoutMs}ms`);
}

async function downloadComfyView(baseUrl, fileMeta, destPath) {
  const fs = require("fs").promises;
  const { filename, subfolder = "", type = "output" } = fileMeta;
  const qs = new URLSearchParams({
    filename,
    type,
    subfolder: subfolder || "",
  });
  const url = `${baseUrl.replace(/\/$/, "")}/view?${qs.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) {
    throw new Error(`ComfyUI view failed ${res.status} ${filename}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

module.exports = {
  uploadImageToComfy,
  submitPrompt,
  waitForComfyOutputs,
  downloadComfyView,
};
