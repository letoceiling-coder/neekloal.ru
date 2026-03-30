"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const agentRunRateLimit = require("../middleware/agentRunRateLimit");
const { runAgentEngine } = require("../services/agentEngineRun");

// ─── LLM helper (same approach as chat.js) ────────────────────────────────────
function getGenerateUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");
  return `${base.replace(/\/$/, "")}/api/generate`;
}

async function ollamaGenerate(model, prompt) {
  const res = await fetch(getGenerateUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.response != null ? String(data.response).trim() : "";
}

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

  // ── POST /agents/auto-generate ───────────────────────────────────────────────
  fastify.post("/agents/auto-generate", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const input = body.input != null ? String(body.input).trim() : "";
    const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";

    if (!input) {
      return reply.code(400).send({ error: "input is required" });
    }

    // Try to pick the assistant's model, fall back to env default
    let model = process.env.DEFAULT_MODEL || "llama3:8b";
    if (assistantId) {
      const assistant = await prisma.assistant.findFirst({
        where: { id: assistantId, organizationId: request.organizationId, deletedAt: null },
        select: { model: true },
      });
      if (assistant?.model) model = assistant.model;
    }

    const systemPrompt =
      "Ты создаёшь правила поведения AI агента.\n\n" +
      "Формат ответа:\n\n" +
      "РОЛЬ:\n...\n\n" +
      "ЦЕЛЬ:\n...\n\n" +
      "ПРАВИЛА:\n— ...\n— ...\n— ...\n\n" +
      "Требования:\n" +
      "— коротко\n" +
      "— конкретные действия\n" +
      "— максимум 6 пунктов\n" +
      "— без абстракций\n" +
      "— только на русском языке";

    const prompt = `${systemPrompt}\n\nЗАДАЧА ПОЛЬЗОВАТЕЛЯ:\n${input}\n\nОтвет:`;

    try {
      const rules = await ollamaGenerate(model, prompt);
      if (!rules) {
        return reply.code(500).send({ error: "LLM returned empty response" });
      }
      fastify.log.info({ model, inputLen: input.length }, "[auto-generate] rules generated");
      return { rules };
    } catch (err) {
      fastify.log.error(err, "[auto-generate] LLM call failed");
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Generation failed" });
    }
  });

  fastify.patch("/agents/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) return reply.code(400).send({ error: "id is required" });

    const body = request.body && typeof request.body === "object" ? request.body : {};
    /** @type {import('@prisma/client').Prisma.AgentUpdateInput} */
    const data = {};

    if (body.name != null) data.name = String(body.name).trim();
    if (body.rules !== undefined) data.rules = body.rules != null ? String(body.rules) : null;
    if (body.assistantId !== undefined) {
      data.assistantId =
        body.assistantId != null && String(body.assistantId).trim() !== ""
          ? String(body.assistantId).trim()
          : null;
    }
    if (body.mode != null) {
      const m = String(body.mode).trim().toLowerCase();
      data.mode = m === "v2" ? "v2" : "v1";
    }
    if (body.trigger !== undefined) data.trigger = body.trigger != null ? String(body.trigger) : null;

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existing = await prisma.agent.findFirst({
      where: { id, organizationId: request.organizationId, deletedAt: null },
    });
    if (!existing) return reply.code(404).send({ error: "Agent not found" });

    const updated = await prisma.agent.update({
      where: { id },
      data,
      include: { tools: true },
    });
    return updated;
  });
};
