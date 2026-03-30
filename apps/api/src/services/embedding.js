"use strict";

/** @type {Map<string, number[]>} */
const embeddingCache = new Map();

function getEmbedCacheMax() {
  const n = parseInt(process.env.RAG_EMBED_CACHE_MAX || "500", 10);
  return Number.isNaN(n) || n < 1 ? 500 : n;
}

function getEmbedTimeoutMs() {
  const n = parseInt(process.env.RAG_EMBED_TIMEOUT_MS || "3000", 10);
  return Number.isNaN(n) || n < 1 ? 3000 : n;
}

/**
 * @param {string} assistantId
 * @param {string} text
 */
function cacheKey(assistantId, text) {
  const aid = assistantId != null && String(assistantId).trim() !== "" ? String(assistantId) : "global";
  return `${aid}:${String(text)}`;
}

/**
 * LRU-ish: refresh key on hit; evict oldest when over capacity.
 * @param {string} key
 * @returns {number[] | null}
 */
function cacheGet(key) {
  if (!embeddingCache.has(key)) {
    return null;
  }
  const v = embeddingCache.get(key);
  embeddingCache.delete(key);
  embeddingCache.set(key, v);
  return v;
}

/**
 * @param {string} key
 * @param {number[]} vec
 */
function cacheSet(key, vec) {
  if (embeddingCache.has(key)) {
    embeddingCache.delete(key);
  }
  embeddingCache.set(key, vec);
  const max = getEmbedCacheMax();
  while (embeddingCache.size > max) {
    const oldest = embeddingCache.keys().next().value;
    embeddingCache.delete(oldest);
  }
}

function getEmbeddingModelName() {
  return process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
}

/**
 * @param {string} url
 * @param {object} body
 * @param {number} timeoutMs
 */
async function fetchEmbeddingsPost(url, body, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Ollama embeddings with timeout + cache key `assistantId:message`.
 * @param {string} text
 * @param {string} [assistantId]
 * @returns {Promise<number[]>}
 */
async function embedText(text, assistantId) {
  const key = cacheKey(assistantId, text);
  const hit = cacheGet(key);
  if (hit) {
    return hit.slice();
  }

  const base = process.env.OLLAMA_URL;
  if (!base) {
    const err = new Error("OLLAMA_URL is not set");
    err.code = "EMBEDDING_FAILED";
    throw err;
  }
  const model = getEmbeddingModelName();
  const url = `${base.replace(/\/$/, "")}/api/embeddings`;
  const timeoutMs = getEmbedTimeoutMs();
  const str = String(text);

  const bodyPrimary = { model, prompt: str };
  let res;
  try {
    res = await fetchEmbeddingsPost(url, bodyPrimary, timeoutMs);
  } catch (e) {
    if (e && e.name === "AbortError") {
      const err = new Error("embedding timeout");
      err.code = "EMBEDDING_TIMEOUT";
      throw err;
    }
    const err = new Error(e instanceof Error ? e.message : String(e));
    err.code = "EMBEDDING_FAILED";
    throw err;
  }

  if (!res.ok) {
    const bodyAlt = { model, input: str };
    try {
      res = await fetchEmbeddingsPost(url, bodyAlt, timeoutMs);
    } catch (e) {
      if (e && e.name === "AbortError") {
        const err = new Error("embedding timeout");
        err.code = "EMBEDDING_TIMEOUT";
        throw err;
      }
      const err = new Error(e instanceof Error ? e.message : String(e));
      err.code = "EMBEDDING_FAILED";
      throw err;
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(`Ollama embeddings failed: ${res.status} ${errText}`);
    err.code = "EMBEDDING_FAILED";
    throw err;
  }

  const data = await res.json();
  const embedding = data.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    const err = new Error("Ollama embeddings returned empty embedding");
    err.code = "EMBEDDING_FAILED";
    throw err;
  }
  const vec = embedding.map((x) => Number(x));
  cacheSet(key, vec);
  return vec.slice();
}

/** @type {number | null} */
let cachedEmbeddingDim = null;

/**
 * @param {(t: string) => Promise<number[]>} embedFn
 */
async function resolveEmbeddingDimension(embedFn) {
  if (cachedEmbeddingDim !== null) {
    return cachedEmbeddingDim;
  }
  const fromEnv = process.env.EMBEDDING_DIMENSION;
  if (fromEnv) {
    const n = parseInt(fromEnv, 10);
    if (!Number.isNaN(n) && n > 0) {
      cachedEmbeddingDim = n;
      return cachedEmbeddingDim;
    }
  }
  const probe = await embedFn(".");
  cachedEmbeddingDim = probe.length;
  return cachedEmbeddingDim;
}

module.exports = {
  embedText,
  resolveEmbeddingDimension,
  getEmbeddingModelName,
};
