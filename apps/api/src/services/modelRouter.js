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

/** Список по умолчанию, если Ollama недоступен или пуст. */
const FALLBACK_MODEL_NAMES = ["llama3", "llama3.2", "mistral"];

/**
 * Опционально: внешний URL (AI Gateway), отдающий JSON `{ "models": string[] }` или массив строк.
 * @returns {Promise<string[]|null>}
 */
async function fetchModelsFromGateway() {
  const url = process.env.AI_GATEWAY_MODELS_URL;
  if (!url || typeof url !== "string" || !url.trim()) {
    return null;
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.trim(), { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = Array.isArray(data) ? data : data && data.models;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const names = raw.map((x) => String(x).trim()).filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch (e) {
    console.error("AI_GATEWAY_MODELS_URL:", e.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Единый источник имён моделей для GET /models (UI, планы).
 * @returns {Promise<string[]>}
 */
async function listAvailableModels() {
  const fromGateway = await fetchModelsFromGateway();
  if (fromGateway && fromGateway.length > 0) {
    return fromGateway;
  }

  const url = process.env.OLLAMA_URL;
  if (!url) {
    return [...FALLBACK_MODEL_NAMES];
  }
  try {
    const names = await fetchModelNames(url);
    const arr = [...names].sort((a, b) => a.localeCompare(b));
    if (arr.length > 0) {
      return arr;
    }
  } catch (e) {
    console.error("listAvailableModels (Ollama):", e.message);
  }
  return [...FALLBACK_MODEL_NAMES];
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

module.exports = {
  resolveModel,
  ensureModelAvailable,
  listAvailableModels,
};
