"use strict";

/** @type {Map<string, number[]>} */
const embeddingCache = new Map();

function getEmbedCacheMax() {
  const n = parseInt(process.env.RAG_EMBED_CACHE_MAX || "500", 10);
  return Number.isNaN(n) || n < 1 ? 500 : n;
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
 * Ollama embeddings: POST /api/embeddings (in-memory cache keyed by exact message text).
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const key = String(text);
  const hit = cacheGet(key);
  if (hit) {
    return hit.slice();
  }

  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  const model = getEmbeddingModelName();
  const url = `${base.replace(/\/$/, "")}/api/embeddings`;

  const bodyPrimary = { model, prompt: key };
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPrimary),
  });

  if (!res.ok) {
    const bodyAlt = { model, input: key };
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyAlt),
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embeddings failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const embedding = data.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Ollama embeddings returned empty embedding");
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
