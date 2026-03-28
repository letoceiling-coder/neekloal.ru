"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function agentsRoutes(fastify) {
  fastify.get("/agents", { preHandler: authMiddleware }, async (request) => {
    return prisma.agent.findMany({
      where: { organizationId: request.organizationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { tools: true },
    });
  });

  fastify.post("/agents", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { name, type, mode, assistantId, rules, trigger, flow, memory } = body;

    if (name == null || String(name).trim() === "") {
      return reply.code(400).send({ error: "name is required" });
    }
    if (type == null || String(type).trim() === "") {
      return reply.code(400).send({ error: "type is required" });
    }

    if (assistantId != null && String(assistantId).trim() !== "") {
      const a = await prisma.assistant.findFirst({
        where: {
          id: String(assistantId),
          organizationId: request.organizationId,
          deletedAt: null,
        },
      });
      if (!a) {
        return reply.code(400).send({ error: "assistant not found or not in organization" });
      }
    }

    const modeStr =
      mode != null && String(mode).trim() !== ""
        ? String(mode).trim().toLowerCase()
        : "v1";

    const row = await prisma.agent.create({
      data: {
        organizationId: request.organizationId,
        name: String(name),
        type: String(type),
        mode: modeStr === "v2" ? "v2" : "v1",
        assistantId:
          assistantId != null && String(assistantId).trim() !== "" ? String(assistantId) : null,
        rules: rules != null ? String(rules) : null,
        trigger: trigger != null ? String(trigger) : null,
        flow: flow !== undefined ? flow : undefined,
        memory: memory !== undefined ? memory : undefined,
      },
      include: { tools: true },
    });

    return reply.code(201).send(row);
  });
};
