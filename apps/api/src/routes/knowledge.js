"use strict";

const prisma = require("../lib/prisma");
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

    const assistant = await prisma.assistant.findFirst({
      where: { id: String(assistantId), userId: request.userId },
    });
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const row = await prisma.knowledge.create({
      data: {
        assistantId: assistant.id,
        type: "text",
        content: String(content),
      },
    });
    return reply.code(201).send(row);
  });
};
