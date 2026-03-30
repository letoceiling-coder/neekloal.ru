"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const { generateAutoAgent } = require("../services/autoAgentService");

/**
 * AI utility routes — config generation, etc.
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function aiRoutes(fastify) {
  /**
   * POST /ai/auto-agent
   * Body: { description: string, assistantId?: string }
   * Returns: { systemPrompt: string, config: object }
   *
   * Does NOT persist to DB — preview only. Caller applies via PATCH /assistants/:id.
   */
  fastify.post("/ai/auto-agent", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const description = body.description != null ? String(body.description).trim() : "";
    const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";

    if (!description) {
      return reply.code(400).send({ error: "description is required" });
    }
    if (description.length < 5) {
      return reply.code(400).send({ error: "description is too short" });
    }

    // Pick assistant's model if provided, else DEFAULT_MODEL env, else hardcoded fallback
    let model = process.env.DEFAULT_MODEL || "llama3:8b";
    if (assistantId) {
      const assistant = await prisma.assistant.findFirst({
        where: { id: assistantId, organizationId: request.organizationId, deletedAt: null },
        select: { model: true },
      });
      if (assistant?.model) model = assistant.model;
    }

    fastify.log.info({ model, descriptionLen: description.length }, "[auto-agent] generating config");

    try {
      const result = await generateAutoAgent(description, model);
      fastify.log.info({ model }, "[auto-agent] config generated successfully");
      return result;
    } catch (err) {
      fastify.log.error(err, "[auto-agent] generation failed");
      return reply
        .code(500)
        .send({ error: err instanceof Error ? err.message : "Config generation failed" });
    }
  });
};
