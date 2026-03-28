"use strict";

const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { embedText, resolveEmbeddingDimension } = require("./embedding");
const { chunkText } = require("./chunking");

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

  const dim = await resolveEmbeddingDimension(embedText);
  await qdrant.ensureCollection(dim);

  const chunkIds = [];

  for (let i = 0; i < parts.length; i++) {
    const piece = parts[i];
    const vector = await embedText(piece);

    const row = await prisma.knowledgeChunk.create({
      data: {
        knowledgeId: knowledge.id,
        content: piece,
        position: i,
      },
    });

    await qdrant.upsertChunkPoint(row.id, vector, {
      assistantId,
      knowledgeId: knowledge.id,
      chunkId: row.id,
      content: piece,
    });

    await prisma.knowledgeChunk.update({
      where: { id: row.id },
      data: { embeddingId: row.id },
    });

    chunkIds.push(row.id);
  }

  fastify.log.info(
    { knowledgeId: knowledge.id, chunksIndexed: chunkIds.length, chunkIds },
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

  if (!qdrant.isRagEnabled()) {
    return { knowledgeBlock: "", chunkIds: [], scores: [] };
  }

  const query = message == null ? "" : String(message).trim();
  if (!query) {
    return { knowledgeBlock: "", chunkIds: [], scores: [] };
  }

  const dim = await resolveEmbeddingDimension(embedText);
  await qdrant.ensureCollection(dim);

  const queryVector = await embedText(query);
  const hits = await qdrant.searchSimilar(queryVector, assistantId, k);

  const texts = [];
  const chunkIds = [];
  const scores = [];
  for (const h of hits) {
    const content = typeof h.payload.content === "string" ? h.payload.content : "";
    if (content) {
      texts.push(content);
    }
    chunkIds.push(h.id);
    scores.push(h.score);
  }

  const knowledgeBlock = texts.join("\n\n---\n\n");

  fastify.log.info(
    {
      assistantId,
      ragChunksFound: hits.length,
      ragChunkIds: chunkIds,
      scores,
    },
    "rag retrieval"
  );

  return { knowledgeBlock, chunkIds, scores };
}

module.exports = {
  ingestKnowledgeDocument,
  retrieveForChat,
};
