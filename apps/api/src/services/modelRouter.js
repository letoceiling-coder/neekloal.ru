"use strict";

/**
 * @param {unknown} message
 * @returns {string}
 */
function resolveModel(message) {
  const msg = message == null ? "" : String(message);
  const lower = msg.toLowerCase();

  if (lower.includes("code") || /\bjs\b/i.test(msg)) {
    return "codellama";
  }
  if (msg.length > 200) {
    return "mixtral";
  }
  if (msg.length <= 50) {
    return "mistral";
  }
  return "llama3:8b";
}

/**
 * @param {string} baseUrl
 * @returns {Promise<Set<string>>}
 */
async function fetchModelNames(baseUrl) {
  const trimmed = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${trimmed}/api/tags`);
  if (!res.ok) {
    return new Set();
  }
  const data = await res.json();
  const models = data.models || [];
  return new Set(models.map((m) => m.name).filter(Boolean));
}

/**
 * @param {string} model
 * @param {string} [baseUrl]
 * @returns {Promise<string>}
 */
async function ensureModelAvailable(model, baseUrl) {
  const url = baseUrl || process.env.OLLAMA_URL;
  if (!url) {
    return "llama3:8b";
  }

  let names;
  try {
    names = await fetchModelNames(url);
  } catch {
    return "llama3:8b";
  }

  if (names.size === 0) {
    return model;
  }

  if (names.has(model)) {
    return model;
  }

  const fallbacks = ["llama3:8b", "llama3", "llama3:latest"];
  for (const fb of fallbacks) {
    if (names.has(fb)) {
      return fb;
    }
  }

  const first = names.values().next().value;
  if (first) {
    return first;
  }

  return "llama3:8b";
}

module.exports = { resolveModel, ensureModelAvailable };
