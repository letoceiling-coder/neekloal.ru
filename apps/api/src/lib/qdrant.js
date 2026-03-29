"use strict";

const { QdrantClient } = require("@qdrant/js-client-rest");

/** @type {import('@qdrant/js-client-rest').QdrantClient | null} */
let _client = null;

/** In-process cache of already-ensured collection names. */
const _ensured = new Set();

// ─── Config ───────────────────────────────────────────────────────────────────

function getQdrantUrl() {
  return process.env.QDRANT_URL ? String(process.env.QDRANT_URL).replace(/\/$/, "") : "";
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
  if (!url) return null;
  if (!_client) _client = new QdrantClient({ url });
  return _client;
}

// ─── Per-assistant collection naming ─────────────────────────────────────────

/**
 * Derive a Qdrant collection name from an assistant UUID.
 * e.g. "dd820951-92dd-4009-9c6d-3cdbf858f2ab" → "asst_dd82095192dd40099c6d3cdbf858f2ab"
 * @param {string} assistantId
 */
function getAssistantCollectionName(assistantId) {
  return `asst_${String(assistantId).replace(/-/g, "")}`;
}

/**
 * Ensure the per-assistant collection exists (idempotent).
 * @param {string} assistantId
 * @param {number} vectorSize
 * @returns {Promise<string>} The collection name
 */
async function ensureAssistantCollection(assistantId, vectorSize) {
  const qc = getClient();
  if (!qc) throw new Error("QDRANT_URL is not set");

  const name = getAssistantCollectionName(assistantId);
  if (_ensured.has(name)) return name;

  const { collections } = await qc.getCollections();
  if (!collections.some((c) => c.name === name)) {
    await qc.createCollection(name, {
      vectors: { size: vectorSize, distance: "Cosine" },
    });
  }

  _ensured.add(name);
  return name;
}

/**
 * Upsert a single vector point into the assistant's collection.
 * @param {string} assistantId
 * @param {string} pointId  UUID
 * @param {number[]} vector
 * @param {Record<string, unknown>} payload
 */
async function upsertAssistantPoint(assistantId, pointId, vector, payload) {
  const qc = getClient();
  if (!qc) throw new Error("QDRANT_URL is not set");
  const name = getAssistantCollectionName(assistantId);
  await qc.upsert(name, {
    wait: true,
    points: [{ id: pointId, vector, payload }],
  });
}

/**
 * Search the assistant's collection for the most similar vectors.
 * @param {string} assistantId
 * @param {number[]} queryVector
 * @param {number} limit
 * @returns {Promise<{ hits: Array<{ id: string; score: number; payload: Record<string, unknown> }>; latencyMs: number }>}
 */
async function searchAssistantSimilar(assistantId, queryVector, limit) {
  const qc = getClient();
  if (!qc) return { hits: [], latencyMs: 0 };

  const name = getAssistantCollectionName(assistantId);
  const timeoutMs = getQdrantTimeoutMs();
  const started = Date.now();

  try {
    const searchPromise = qc.search(name, {
      vector: queryVector,
      limit,
      with_payload: true,
    });

    const res = await Promise.race([
      searchPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Object.assign(new Error("qdrant search timeout"), { code: "QDRANT_TIMEOUT" })),
          timeoutMs
        )
      ),
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

/**
 * Delete specific points from the assistant's collection.
 * @param {string} assistantId
 * @param {string[]} pointIds
 */
async function deleteAssistantPoints(assistantId, pointIds) {
  if (!pointIds.length) return;
  const qc = getClient();
  if (!qc) return;
  const name = getAssistantCollectionName(assistantId);
  await qc
    .delete(name, { wait: false, points: pointIds })
    .catch((e) => process.stderr.write(`[qdrant] deletePoints failed: ${e.message}\n`));
}

// ─── Legacy shims (backward compat with old single-collection code) ───────────

// Kept so existing rag.js imports still work during migration;
// they now route to the per-assistant collection.

let _legacyCollEnsured = false;

async function ensureCollection(vectorSize) {
  // Used only as legacy shim; real code calls ensureAssistantCollection
  if (!_legacyCollEnsured) {
    const qc = getClient();
    if (!qc) return;
    const name = "knowledge_chunks";
    const { collections } = await qc.getCollections();
    if (!collections.some((c) => c.name === name)) {
      await qc.createCollection(name, { vectors: { size: vectorSize, distance: "Cosine" } });
    }
    _legacyCollEnsured = true;
  }
}

async function upsertChunkPoint(pointId, vector, payload) {
  const { assistantId } = payload;
  if (assistantId) {
    await upsertAssistantPoint(String(assistantId), pointId, vector, payload);
  }
}

async function searchSimilar(queryVector, assistantId, limit) {
  return searchAssistantSimilar(assistantId, queryVector, limit);
}

function getCollectionName() {
  return "knowledge_chunks";
}

module.exports = {
  getClient,
  isRagEnabled,
  getQdrantUrl,
  getAssistantCollectionName,
  ensureAssistantCollection,
  upsertAssistantPoint,
  searchAssistantSimilar,
  deleteAssistantPoints,
  // Legacy
  ensureCollection,
  upsertChunkPoint,
  searchSimilar,
  getCollectionName,
};
