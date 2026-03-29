"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const agentRunRateLimit = require("../middleware/agentRunRateLimit");
const { runAgentEngine } = require("../services/agentEngineRun");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function agentsRoutes(fastify) {
  fastify.post("/agents/run", { preHandler: [authMiddleware, agentRunRateLimit] }, async (request, reply) => {
    if (request.userId == null) {
      return reply.code(403).send({ error: "No acting user for this organization" });
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    const agentId = body.agentId != null ? String(body.agentId).trim() : "";
    const message = body.message != null ? String(body.message) : "";
    const conversationId =
      body.conversationId != null && String(body.conversationId).trim() !== ""
        ? String(body.conversationId).trim()
        : null;

    if (!agentId) {
      return reply.code(400).send({ error: "agentId is required" });
    }
    if (!message.trim()) {
      return reply.code(400).send({ error: "message is required" });
    }

    try {
      const result = await runAgentEngine({
        organizationId: request.organizationId,
        userId: request.userId,
        agentId,
        message,
        conversationId: conversationId ?? undefined,
      });

      if (conversationId) {
        const conv = await prisma.conversation.findFirst({
          where: {
            id: conversationId,
            organizationId: request.organizationId,
            deletedAt: null,
          },
        });
        if (conv) {
          await prisma.message.create({
            data: {
              organizationId: request.organizationId,
              conversationId,
              role: "user",
              content: message.trim(),
            },
          });
          if (result.output != null && String(result.output).length > 0) {
            await prisma.message.create({
              data: {
                organizationId: request.organizationId,
                conversationId,
                role: "assistant",
                content: String(result.output),
                executionId: result.executionId,
              },
            });
          }
        }
      }

      return {
        executionId: result.executionId,
        output: result.output,
        steps: result.steps,
      };
    } catch (err) {
      const code = err && err.message;
      if (code === "AGENT_NOT_FOUND") {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (code === "ASSISTANT_REQUIRED") {
        return reply
          .code(400)
          .send({ error: "Agent must have an assistant linked to run the engine" });
      }
      if (code === "EMPTY_MESSAGE") {
        return reply.code(400).send({ error: "message is required" });
      }
      if (code === "CONVERSATION_NOT_FOUND") {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      if (code === "CONVERSATION_AGENT_MISMATCH") {
        return reply
          .code(400)
          .send({ error: "Conversation is bound to another agent" });
      }
      fastify.log.error(err);
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Agent run failed" });
    }
  });

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
