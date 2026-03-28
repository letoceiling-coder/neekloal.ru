"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * GET /tools, POST /tools — tools belong to user's agents.
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function toolsHttpRoutes(fastify) {
  fastify.get("/tools", { preHandler: authMiddleware }, async (request) => {
    const agentId = request.query && request.query.agentId ? String(request.query.agentId) : null;
    return prisma.tool.findMany({
      where: {
        agent: { userId: request.userId },
        ...(agentId ? { agentId } : {}),
      },
      orderBy: { createdAt: "asc" },
      include: {
        agent: { select: { id: true, name: true, assistantId: true } },
      },
    });
  });

  fastify.post("/tools", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { agentId, type, config } = body;

    if (agentId == null || String(agentId).trim() === "") {
      return reply.code(400).send({ error: "agentId is required" });
    }
    if (type == null || String(type).trim() === "") {
      return reply.code(400).send({ error: "type is required" });
    }
    if (config == null || typeof config !== "object") {
      return reply.code(400).send({ error: "config object is required" });
    }

    const agent = await prisma.agent.findFirst({
      where: { id: String(agentId), userId: request.userId },
    });
    if (!agent) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    const row = await prisma.tool.create({
      data: {
        agentId: agent.id,
        type: String(type),
        config,
      },
      include: {
        agent: { select: { id: true, name: true, assistantId: true } },
      },
    });

    return reply.code(201).send(row);
  });
};
