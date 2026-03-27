"use strict";

const crypto = require("crypto");
const { append } = require("../services/knowledgeStore");
const { findById } = require("../services/assistantsStore");
const authMiddleware = require("../middleware/auth");

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

    const assistant = findById(String(assistantId));
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }
    if (assistant.userId !== request.userId) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const row = {
      id: crypto.randomUUID(),
      assistantId: String(assistantId),
      content: String(content),
    };
    append(row);
    return reply.code(201).send(row);
  });
};
