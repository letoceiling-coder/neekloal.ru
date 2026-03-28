"use strict";

const { randomUUID } = require("crypto");
const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { embedText, resolveEmbeddingDimension, getEmbeddingModelName } = require("./embedding");
const { chunkText } = require("./chunking");

/**
 * Rough token estimate (~4 chars per token) for logging / limits.
 * @param {string} text
 */
function estimateTokensRough(text) {
  return Math.max(0, Math.ceil(String(text).length / 4));
}

/** Reserve 20% headroom vs configured caps (token-safe). */
const TOKEN_BUDGET_SAFETY = 0.8;

/**
 * Cap KNOWLEDGE block size (chars + optional token budget).
 * @param {string} text
 * @returns {{ text: string; truncated: boolean }}
 */
function limitKnowledgeBlock(text) {
  const maxCharsCfg = parseInt(process.env.RAG_KNOWLEDGE_MAX_CHARS || "12000", 10) || 12000;
  const maxTokensEnv = process.env.RAG_KNOWLEDGE_MAX_TOKENS;

  let maxCharsEff = Math.floor(maxCharsCfg * TOKEN_BUDGET_SAFETY);
  if (maxTokensEnv) {
    const mt = parseInt(maxTokensEnv, 10);
    if (!Number.isNaN(mt) && mt > 0) {
      const effectiveTokens = Math.floor(mt * TOKEN_BUDGET_SAFETY);
      maxCharsEff = Math.min(maxCharsEff, effectiveTokens * 4);
    }
  }

  const t = String(text);
  if (t.length <= maxCharsEff) {
    return { text: t, truncated: false };
  }
  return { text: t.slice(0, maxCharsEff) + "\n\n[TRUNCATED]", truncated: true };
}

/**
 * Full ingest: chunks → embeddings → Qdrant + KnowledgeChunk rows.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ id: string; content: string }} knowledge
 * @param {string} assistantId
 */
async function ingestKnowledgeDocument(fastify, knowledge, assistantId) {
  if (!qdrant.isRagEnabled()) {
    return { chunksIndexed: 0, chunkIds: [] };
  }

  const parts = chunkText(knowledge.content);
  if (parts.length === 0) {
    return { chunksIndexed: 0, chunkIds: [] };
  }

  const dim = await resolveEmbeddingDimension((t) => embedText(t, assistantId));
  await qdrant.ensureCollection(dim);

  const modelName = getEmbeddingModelName();
  const chunkIds = [];

  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i];
    const vector = await embedText(piece, assistantId);
    const id = randomUUID();

    const row = await prisma.knowledgeChunk.create({
      data: {
        id,
        knowledgeId: knowledge.id,
        content: piece,
        position: i,
        embeddingModel: modelName,
        embeddingDim: vector.length,
        embeddingId: id,
      },
    });

    await qdrant.upsertChunkPoint(row.id, vector, {
      assistantId,
      knowledgeId: knowledge.id,
      chunkId: row.id,
      content: piece,
    });

    chunkIds.push(row.id);
  }

  fastify.log.info(
    { knowledgeId: knowledge.id, chunksIndexed: chunkIds.length, chunkIds, embeddingModel: modelName, embeddingDim: dim },
    "rag ingest complete"
  );

  return { chunksIndexed: chunkIds.length, chunkIds };
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} assistantId
 * @param {unknown} message
 * @param {number} [topK]
 * @returns {Promise<{ knowledgeBlock: string; chunkIds: string[]; scores: number[] }>}
 */
async function retrieveForChat(fastify, assistantId, message, topK) {
  const k = topK != null ? topK : parseInt(process.env.RAG_TOP_K || "5", 10) || 5;
  const candidateLimit = parseInt(process.env.RAG_SEARCH_CANDIDATES || "24", 10) || 24;
  let minScore = parseFloat(process.env.RAG_MIN_SCORE || "0.7");
  if (Number.isNaN(minScore)) {
    minScore = 0.7;
  }

  if (!qdrant.isRagEnabled()) {
    return { knowledgeBlock: "", chunkIds: [], scores: [] };
  }

  const query = message == null ? "" : String(message).trim();
  if (!query) {
    return { knowledgeBlock: "", chunkIds: [], scores: [] };
  }

  const ragStart = Date.now();
  let embeddingLatencyMs = 0;
  let qdrantLatencyMs = 0;

  const wrapEmbed = async (t) => {
    const s = Date.now();
    try {
      return await embedText(t, assistantId);
    } finally {
      embeddingLatencyMs += Date.now() - s;
    }
  };

  try {
    const dim = await resolveEmbeddingDimension(wrapEmbed);
    await qdrant.ensureCollection(dim);

    const queryVector = await wrapEmbed(query);

    const { hits: hitsRaw, latencyMs: qL } = await qdrant.searchSimilar(queryVector, assistantId, candidateLimit);
    qdrantLatencyMs = qL;

    let minScoreUsed = minScore;
    let passed = hitsRaw.filter((h) => Number(h.score) >= minScoreUsed);
    let adaptiveScoreFallback = false;
    if (passed.length === 0 && hitsRaw.length > 0) {
      minScoreUsed = 0.5;
      passed = hitsRaw.filter((h) => Number(h.score) >= minScoreUsed);
      adaptiveScoreFallback = true;
    }

    const top = passed.slice(0, k);

    const texts = [];
    const chunkIds = [];
    const scores = [];
    for (const h of top) {
      const content = typeof h.payload.content === "string" ? h.payload.content : "";
      if (content) {
        texts.push(content);
      }
      chunkIds.push(h.id);
      scores.push(h.score);
    }

    let knowledgeBlock = texts.join("\n\n---\n\n");
    const limited = limitKnowledgeBlock(knowledgeBlock);
    knowledgeBlock = limited.text;

    const totalTokensKnowledge = estimateTokensRough(knowledgeBlock);
    const ragLatencyMs = Date.now() - ragStart;

    fastify.log.info(
      {
        assistantId,
        retrievalCandidates: hitsRaw.length,
        filteredChunksCount: passed.length,
        droppedByMinScore: hitsRaw.length - passed.length,
        ragChunksUsed: top.length,
        ragChunkIds: chunkIds,
        scores,
        minScoreInitial: minScore,
        minScoreUsed,
        adaptiveScoreFallback,
        totalTokensKnowledge,
        knowledgeBlockTruncated: limited.truncated,
        ragLatencyMs,
        embeddingLatencyMs,
        qdrantLatencyMs,
        ragFallback: false,
      },
      "rag retrieval"
    );

    return { knowledgeBlock, chunkIds, scores };
  } catch (err) {
    const ragLatencyMs = Date.now() - ragStart;
    fastify.log.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        errCode: err && typeof err === "object" && "code" in err ? err.code : undefined,
        ragLatencyMs,
        embeddingLatencyMs,
        qdrantLatencyMs,
        ragFallback: true,
      },
      "rag retrieval failed; using fallback knowledge"
    );
    return { knowledgeBlock: "", chunkIds: [], scores: [] };
  }
}

module.exports = {
  ingestKnowledgeDocument,
  retrieveForChat,
  estimateTokensRough,
  limitKnowledgeBlock,
};
