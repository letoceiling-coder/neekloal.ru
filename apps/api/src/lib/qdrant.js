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
 * @returns {Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>>}
 */
async function searchSimilar(queryVector, assistantId, limit) {
  const qc = getClient();
  if (!qc) {
    throw new Error("QDRANT_URL is not set");
  }
  const name = getCollectionName();
  const res = await qc.search(name, {
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
  return res.map((r) => ({
    id: String(r.id),
    score: r.score ?? 0,
    payload: r.payload || {},
  }));
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
