"use strict";

/**
 * Ollama embeddings: POST /api/embeddings
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  const model = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
  const url = `${base.replace(/\/$/, "")}/api/embeddings`;

  const bodyPrimary = { model, prompt: String(text) };
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyPrimary),
  });

  if (!res.ok) {
    const bodyAlt = { model, input: String(text) };
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
  return embedding.map((x) => Number(x));
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
};
