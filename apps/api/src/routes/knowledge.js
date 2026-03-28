"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const qdrant = require("../lib/qdrant");
const { ingestKnowledgeDocument } = require("../services/rag");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function knowledgeRoutes(fastify) {
  fastify.post("/knowledge", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const assistantId = body.assistantId;
    const content = body.content;

    if (assistantId == null || String(assistantId).trim() === "") {
      return reply.code(400).send({ error: "assistantId is required" });
    }
    if (content == null) {
      return reply.code(400).send({ error: "content is required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: String(assistantId),
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const text = String(content);

    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "text",
        content: text,
      },
    });

    if (qdrant.isRagEnabled()) {
      try {
        await ingestKnowledgeDocument(fastify, row, assistant.id);
      } catch (err) {
        fastify.log.error(err, "rag ingest failed; rolling back knowledge row");
        await prisma.knowledge.delete({ where: { id: row.id } }).catch(() => {});
        return reply.code(502).send({
          error: "RAG indexing failed",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return reply.code(201).send(row);
  });
};
