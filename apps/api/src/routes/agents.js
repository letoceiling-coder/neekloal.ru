"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const agentRunRateLimit = require("../middleware/agentRunRateLimit");
const { runAgentEngine } = require("../services/agentEngineRun");
const { agentChat } = require("../services/agentRuntime");
const {
  createConversation,
  getConversation,
  listConversations,
  clearConversation,
  agentChatV2,
  streamAgentChat,
} = require("../services/agentRuntimeV2");

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
    const { name, type, mode, assistantId, rules, trigger, flow, memory, model } = body;

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

    // v2 is the only supported mode; "v1" is a legacy fallback kept for backward compat only
    const modeStr = "v2";

    const agentModel = model != null && String(model).trim() !== "" ? String(model).trim() : null;

    const row = await prisma.agent.create({
      data: {
        organizationId: request.organizationId,
        name:  String(name),
        type:  String(type),
        mode:  modeStr,
        model: agentModel,
        assistantId:
          assistantId != null && String(assistantId).trim() !== "" ? String(assistantId) : null,
        rules:   rules   != null ? String(rules)   : null,
        trigger: trigger != null ? String(trigger) : null,
        flow:    flow    !== undefined ? flow    : undefined,
        memory:  memory  !== undefined ? memory  : undefined,
      },
      include: { tools: true },
    });

    process.stdout.write(`[agent:create] id=${row.id} name="${row.name}" model=${agentModel ?? "default"}\n`);
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

    if (body.name  != null) data.name  = String(body.name).trim();
    if (body.model !== undefined) data.model = body.model != null && String(body.model).trim() ? String(body.model).trim() : null;
    if (body.rules !== undefined) data.rules = body.rules != null ? String(body.rules) : null;
    if (body.assistantId !== undefined) {
      data.assistantId =
        body.assistantId != null && String(body.assistantId).trim() !== ""
          ? String(body.assistantId).trim()
          : null;
    }
    if (body.mode != null) {
      // v2 is the default; accept explicit "v1" only for legacy backward compat
      const m = String(body.mode).trim().toLowerCase();
      data.mode = m === "v1" ? "v1" : "v2";
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

  // ── POST /agents/chat ─────────────────────────────────────────────────────
  // Playground: chat with an agent using its rules as system prompt.
  fastify.post("/agents/chat", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) {
      return reply.code(403).send({ error: "Authentication required" });
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    const agentId  = body.agentId  != null ? String(body.agentId).trim()  : "";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model    = body.model    != null ? String(body.model).trim()    : null;
    const reset    = body.reset === true;

    if (!agentId) {
      return reply.code(400).send({ error: "agentId is required" });
    }

    // Validate messages array
    for (const m of messages) {
      if (!m || typeof m !== "object" || typeof m.content !== "string" || !m.content.trim()) {
        return reply.code(400).send({ error: "Each message must have a non-empty content string" });
      }
      if (!["user", "assistant", "system"].includes(m.role)) {
        return reply.code(400).send({ error: `Invalid message role: ${m.role}` });
      }
    }

    // Load agent from DB — must belong to the user's organization
    const agent = await prisma.agent.findFirst({
      where: {
        id:             agentId,
        organizationId: request.organizationId,
        deletedAt:      null,
      },
    });
    if (!agent) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    // Use agent.rules as system prompt (trim to avoid whitespace-only prompts)
    const systemPrompt = agent.rules && agent.rules.trim() ? agent.rules : null;

    // Model priority: user-selected → agent.model → fallback
    const { selectModel: _sm } = require("../services/modelRouter");
    const modelSource  = (model && model.trim()) ? "user" : (agent.model ? "agent" : "fallback");
    const resolvedModel = (model && model.trim()) || agent.model || null;
    process.stdout.write(`[agent:model] selected=${resolvedModel ?? _sm("chat")} source=${modelSource}\n`);

    try {
      const result = await agentChat({
        agentId,
        userId:       request.userId,
        systemPrompt,
        messages,
        model:        resolvedModel,
        reset,
      });

      return reply.code(200).send(result);
    } catch (err) {
      request.log.error({ err }, "agentChat failed");
      return reply.code(502).send({ error: `LLM error: ${err.message}` });
    }
  });

  // ── POST /agents/conversations ────────────────────────────────────────────
  // Create a new playground conversation (V2).
  fastify.post("/agents/conversations", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });

    const body    = request.body && typeof request.body === "object" ? request.body : {};
    const agentId = body.agentId != null ? String(body.agentId).trim() : "";
    const title   = body.title   != null ? String(body.title).trim()   : null;

    if (!agentId) return reply.code(400).send({ error: "agentId is required" });

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const conv = await createConversation(agentId, request.userId, request.organizationId, title);
    return reply.code(201).send(conv);
  });

  // ── GET /agents/conversations/detail/:id ──────────────────────────────────
  // Fetch full conversation (including messages array) by ID.
  // IMPORTANT: this must be defined BEFORE /agents/conversations/:agentId
  fastify.get("/agents/conversations/detail/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });

    const { id } = request.params;
    const conv = await getConversation(id, request.organizationId);
    if (!conv) return reply.code(404).send({ error: "Conversation not found" });
    return conv;
  });

  // ── GET /agents/conversations/:agentId ───────────────────────────────────
  // List conversations for an agent (metadata only, no message bodies).
  fastify.get("/agents/conversations/:agentId", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });

    const { agentId } = request.params;
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const list = await listConversations(agentId, request.organizationId);
    return { conversations: list };
  });

  // ── POST /agents/chat/v2 ─────────────────────────────────────────────────
  // DB-persisted single-turn chat (non-streaming).
  fastify.post("/agents/chat/v2", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });

    const body           = request.body && typeof request.body === "object" ? request.body : {};
    const conversationId = body.conversationId != null ? String(body.conversationId).trim() : "";
    const message        = body.message        != null ? String(body.message).trim()        : "";
    const model          = body.model          != null ? String(body.model).trim()          : null;
    const systemPrompt   = body.systemPrompt   != null ? String(body.systemPrompt)          : null;
    const temperature    = body.temperature    != null ? Number(body.temperature)            : null;
    const maxTokens      = body.maxTokens      != null ? Number(body.maxTokens)              : null;

    if (!conversationId) return reply.code(400).send({ error: "conversationId is required" });
    if (!message)        return reply.code(400).send({ error: "message is required" });

    // Resolve model with priority: user → agent.model → fallback
    const { selectModel: _selectModel } = require("../services/modelRouter");
    let agentModelV2 = null;
    try {
      const conv = await prisma.agentConversation.findFirst({ where: { id: conversationId } });
      if (conv?.agentId) {
        const ag = await prisma.agent.findFirst({ where: { id: conv.agentId }, select: { model: true } });
        agentModelV2 = ag?.model || null;
      }
    } catch { /* non-fatal */ }
    const modelSrcV2 = model ? "user" : (agentModelV2 ? "agent" : "fallback");
    const resolvedModelV2 = model || agentModelV2 || null;
    process.stdout.write(`[agent:model] selected=${resolvedModelV2 ?? _selectModel("chat")} source=${modelSrcV2}\n`);

    try {
      const result = await agentChatV2({
        conversationId,
        message,
        organizationId: request.organizationId,
        systemPrompt: systemPrompt || null,
        model:        resolvedModelV2,
        temperature:  temperature  != null && !isNaN(temperature) ? temperature : undefined,
        maxTokens:    maxTokens    != null && !isNaN(maxTokens)   ? maxTokens   : undefined,
      });
      return reply.code(200).send(result);
    } catch (err) {
      request.log.error({ err }, "agentChatV2 failed");
      return reply.code(502).send({ error: `LLM error: ${err.message}` });
    }
  });

  // ── POST /agents/chat/stream ─────────────────────────────────────────────
  // DB-persisted streaming chat — SSE (event: token / event: done / event: error).
  const STREAM_TIMEOUT_MS = 60_000;
  fastify.post("/agents/chat/stream", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });

    const body           = request.body && typeof request.body === "object" ? request.body : {};
    const conversationId = body.conversationId != null ? String(body.conversationId).trim() : "";
    const message        = body.message        != null ? String(body.message).trim()        : "";
    const model          = body.model          != null ? String(body.model).trim()          : null;
    const systemPrompt   = body.systemPrompt   != null ? String(body.systemPrompt)          : null;
    const temperature    = body.temperature    != null ? Number(body.temperature)            : null;
    const maxTokens      = body.maxTokens      != null ? Number(body.maxTokens)              : null;

    if (!conversationId) return reply.code(400).send({ error: "conversationId is required" });
    if (!message)        return reply.code(400).send({ error: "message is required" });

    // Resolve model priority: user → agent.model → fallback
    const { selectModel: _smStream } = require("../services/modelRouter");
    let agentModelStream = null;
    try {
      const convS = await prisma.agentConversation.findFirst({ where: { id: conversationId } });
      if (convS?.agentId) {
        const agS = await prisma.agent.findFirst({ where: { id: convS.agentId }, select: { model: true } });
        agentModelStream = agS?.model || null;
      }
    } catch { /* non-fatal */ }
    const modelSrcStream = model ? "user" : (agentModelStream ? "agent" : "fallback");
    const resolvedModelStream = model || agentModelStream || null;
    process.stdout.write(`[agent:model] selected=${resolvedModelStream ?? _smStream("chat")} source=${modelSrcStream}\n`);

    // Hijack response for SSE
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      "Content-Type":                 "text/event-stream; charset=utf-8",
      "Cache-Control":                "no-cache, no-transform",
      "Connection":                   "keep-alive",
      "X-Accel-Buffering":            "no",
      "Access-Control-Allow-Origin":  request.headers.origin || "*",
    });

    let streamEnded = false;
    const ollamaAbort = new AbortController();

    function send(event, data) {
      if (!streamEnded) {
        try { raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignore write errors */ }
      }
    }

    const timeoutId = setTimeout(() => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaAbort.abort();
        send("error", { error: "Stream timeout (60s)" });
        raw.end();
      }
    }, STREAM_TIMEOUT_MS);

    request.raw.on("close", () => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaAbort.abort();
        clearTimeout(timeoutId);
      }
    });

    try {
      const generator = streamAgentChat({
        conversationId,
        message,
        organizationId: request.organizationId,
        systemPrompt:  systemPrompt || null,
        model:         resolvedModelStream,
        temperature:   temperature  != null && !isNaN(temperature) ? temperature : undefined,
        maxTokens:     maxTokens    != null && !isNaN(maxTokens)   ? maxTokens   : undefined,
        signal:        ollamaAbort.signal,
      });

      for await (const chunk of generator) {
        if (streamEnded) break;
        if (chunk.done) {
          send("done", chunk);
        } else {
          send("token", { token: chunk.token });
        }
      }
    } catch (err) {
      request.log.error({ err }, "agentChat/stream failed");
      if (!streamEnded) send("error", { error: err.message });
    } finally {
      clearTimeout(timeoutId);
      if (!streamEnded) {
        streamEnded = true;
        raw.end();
      }
    }
  });

  // ── DELETE /agents/conversations/:id ─────────────────────────────────────
  // Clear (wipe messages) or fully delete a conversation.
  fastify.delete("/agents/conversations/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    if (!request.userId) return reply.code(403).send({ error: "Authentication required" });
    const { id } = request.params;
    await clearConversation(id, request.organizationId);
    return reply.code(204).send();
  });
};
