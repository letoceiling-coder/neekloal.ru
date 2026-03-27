"use strict";

function getTagsUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}/api/tags`;
}

/**
 * @returns {Promise<"connected"|"offline">}
 */
async function checkOllama() {
  let timeout;
  try {
    const tagsUrl = getTagsUrl();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(tagsUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) return "connected";
    return "offline";
  } catch (error) {
    clearTimeout(timeout);
    console.error("OLLAMA ERROR:", error.message);
    return "offline";
  }
}

module.exports = { checkOllama };
