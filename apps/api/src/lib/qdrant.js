"use strict";

const { QdrantClient } = require("@qdrant/js-client-rest");

/** @type {import('@qdrant/js-client-rest').QdrantClient | null} */
let client;

let collectionEnsured = false;

function getQdrantUrl() {
  return process.env.QDRANT_URL ? String(process.env.QDRANT_URL).replace(/\/$/, "") : "";
}

function getCollectionName() {
  return process.env.QDRANT_COLLECTION || "knowledge_chunks";
}

function getQdrantTimeoutMs() {
  const n = parseInt(process.env.RAG_QDRANT_TIMEOUT_MS || "3000", 10);
  return Number.isNaN(n) || n < 1 ? 3000 : n;
}

function isRagEnabled() {
  return Boolean(getQdrantUrl());
}

function getClient() {
  const url = getQdrantUrl();
  if (!url) {
    return null;
  }
  if (!client) {
    client = new QdrantClient({ url });
  }
  return client;
}

/**
 * @param {number} vectorSize
 */
async function ensureCollection(vectorSize) {
  if (collectionEnsured) {
    return;
  }
  const qc = getClient();
  if (!qc) {
    throw new Error("QDRANT_URL is not set");
  }
  const name = getCollectionName();
  const cols = await qc.getCollections();
  const exists = cols.collections.some((c) => c.name === name);
  if (!exists) {
    await qc.createCollection(name, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }
  collectionEnsured = true;
}

/**
 * @param {string} pointId UUID string
 * @param {number[]} vector
 * @param {{ assistantId: string; knowledgeId: string; chunkId: string; content: string }} payload
 */
async function upsertChunkPoint(pointId, vector, payload) {
  const qc = getClient();
  if (!qc) {
    throw new Error("QDRANT_URL is not set");
  }
  const name = getCollectionName();
  await qc.upsert(name, {
    wait: true,
    points: [
      {
        id: pointId,
        vector,
        payload: {
          assistantId: payload.assistantId,
          knowledgeId: payload.knowledgeId,
          chunkId: payload.chunkId,
          content: payload.content,
        },
      },
    ],
  });
}

/**
 * @param {number[]} queryVector
 * @param {string} assistantId
 * @param {number} limit
 * @returns {Promise<{ hits: Array<{ id: string; score: number; payload: Record<string, unknown> }>; latencyMs: number }>}
 */
async function searchSimilar(queryVector, assistantId, limit) {
  const qc = getClient();
  if (!qc) {
    return { hits: [], latencyMs: 0 };
  }
  const name = getCollectionName();
  const timeoutMs = getQdrantTimeoutMs();
  const started = Date.now();

  try {
    const searchPromise = qc.search(name, {
      vector: queryVector,
      limit,
      filter: {
        must: [
          {
            key: "assistantId",
            match: { value: assistantId },
          },
        ],
      },
      with_payload: true,
    });

    const res = await Promise.race([
      searchPromise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(Object.assign(new Error("qdrant search timeout"), { code: "QDRANT_TIMEOUT" }));
        }, timeoutMs);
      }),
    ]);

    const latencyMs = Date.now() - started;
    const hits = res.map((r) => ({
      id: String(r.id),
      score: r.score ?? 0,
      payload: r.payload || {},
    }));
    return { hits, latencyMs };
  } catch {
    return { hits: [], latencyMs: Date.now() - started };
  }
}

module.exports = {
  getClient,
  getCollectionName,
  getQdrantUrl,
  isRagEnabled,
  ensureCollection,
  upsertChunkPoint,
  searchSimilar,
};
