"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function assistantsRoutes(fastify) {
  fastify.get("/assistants", { preHandler: authMiddleware }, async (request) => {
    return prisma.assistant.findMany({
      where: { organizationId: request.organizationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  });

  fastify.post("/assistants", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { name, model, systemPrompt } = body;

    if (name == null || String(name).trim() === "") {
      return reply.code(400).send({ error: "name is required" });
    }
    if (model == null || String(model).trim() === "") {
      return reply.code(400).send({ error: "model is required" });
    }
    if (systemPrompt == null) {
      return reply.code(400).send({ error: "systemPrompt is required" });
    }

    const assistant = await prisma.assistant.create({
      data: {
        organizationId: request.organizationId,
        name: String(name),
        model: String(model),
        systemPrompt: String(systemPrompt),
      },
    });
    return reply.code(201).send(assistant);
  });
};
