"use strict";

/**
 * routes/v1.js — Public Developer API v1.
 *
 * Base prefix: /api/v1  (registered in app.js with { prefix: "/api/v1" })
 *
 * Routes:
 *   POST /api/v1/chat                    — non-streaming chat (JSON response)
 *   POST /api/v1/chat/stream             — streaming chat (SSE: event/token, event/done, event/error)
 *   POST /api/v1/product-photos/verify   — vision check: product card vs image URLs → active flags
 *
 * Authentication:
 *   Authorization: Bearer sk_live_…   API key (X-Api-Key also accepted)
 *   Authorization: Bearer <JWT>        internal JWT (for dashboard testing)
 *
 * Context:
 *   conversationId is optional.  If omitted a new conversation is created
 *   automatically and its id is returned so the client can continue the thread.
 *
 * Rate limiting: 60 req/min per API key, 30 req/min per JWT session.
 */

const prisma            = require("../lib/prisma");
const chatAuthMiddleware = require("../middleware/chatAuth");
const rateLimitMiddleware = require("../middleware/rateLimit");
const { selectModel }   = require("../services/modelRouter");
const {
  agentChatV2,
  streamAgentChat,
  createConversation,
} = require("../services/agentRuntimeV2");
const { verifyProductPhotos } = require("../services/productPhotoVerify");

const STREAM_TIMEOUT_MS = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load agent and verify it belongs to the authenticated org.
 * Returns null if not found / access denied.
 */
async function loadAgent(agentId, organizationId) {
  return prisma.agent.findFirst({
    where: { id: agentId, organizationId, deletedAt: null },
    select: { id: true, name: true, rules: true, model: true },
  });
}

/**
 * Resolve or create an AgentConversation.
 *
 * If conversationId is provided — verify it belongs to the org+agent.
 * If omitted — create a new blank conversation.
 *
 * @returns {{ conv: object, created: boolean }}
 */
async function resolveConversation(conversationId, agentId, organizationId, userId) {
  if (conversationId) {
    const conv = await prisma.agentConversation.findFirst({
      where: { id: conversationId, agentId, organizationId },
    });
    if (!conv) return { conv: null, created: false };
    return { conv, created: false };
  }

  // Auto-create new conversation
  const conv = await createConversation(agentId, userId ?? agentId, organizationId, null);
  return { conv, created: true };
}

// ── Route plugin ──────────────────────────────────────────────────────────────

module.exports = async function v1Routes(fastify) {

  // ── POST /chat ─────────────────────────────────────────────────────────────
  fastify.post("/chat", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware],
  }, async (request, reply) => {
    const body           = typeof request.body === "object" && request.body ? request.body : {};
    const agentId        = body.agentId        ? String(body.agentId).trim()        : "";
    const message        = body.message        ? String(body.message).trim()        : "";
    const conversationId = body.conversationId ? String(body.conversationId).trim() : null;
    const model          = body.model          ? String(body.model).trim()          : null;
    const temperature    = body.temperature    != null ? Number(body.temperature)   : null;
    const maxTokens      = body.maxTokens      != null ? Number(body.maxTokens)     : null;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!agentId) {
      return reply.code(400).send({
        error: "agentId is required",
        hint:  "Pass the agent UUID in the request body: { agentId: '…', message: '…' }",
      });
    }
    if (!message) {
      return reply.code(400).send({ error: "message is required" });
    }

    // ── Load agent ────────────────────────────────────────────────────────────
    const agent = await loadAgent(agentId, request.organizationId);
    if (!agent) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    // ── Resolve conversation ──────────────────────────────────────────────────
    const { conv, created } = await resolveConversation(
      conversationId, agentId, request.organizationId, request.userId
    );
    if (!conv) {
      return reply.code(404).send({ error: "conversationId not found for this agent" });
    }

    // ── Model priority: request → agent.model → system fallback ──────────────
    const resolvedModel = model || agent.model || null;
    const modelSource   = model ? "request" : (agent.model ? "agent" : "system");
    process.stdout.write(
      `[v1:chat] agentId=${agentId} conv=${conv.id} model=${resolvedModel ?? selectModel("chat")} src=${modelSource}\n`
    );

    // ── Generate reply ────────────────────────────────────────────────────────
    let result;
    try {
      result = await agentChatV2({
        conversationId:  conv.id,
        message,
        organizationId:  request.organizationId,
        systemPrompt:    agent.rules?.trim() || null,
        model:           resolvedModel,
        temperature:     temperature != null && !isNaN(temperature) ? temperature : undefined,
        maxTokens:       maxTokens   != null && !isNaN(maxTokens)   ? maxTokens   : undefined,
      });
    } catch (err) {
      request.log.error({ err }, "[v1:chat] agentChatV2 failed");
      return reply.code(502).send({ error: `AI error: ${err.message}` });
    }

    return reply.code(200).send({
      reply:          result.reply,
      conversationId: result.conversationId,
      model:          result.modelUsed,
      tokens:         result.tokens,
      created,               // true when a new conversation was auto-created
    });
  });

  // ── POST /chat/stream ──────────────────────────────────────────────────────
  // Server-Sent Events (SSE).
  //
  // Events emitted:
  //   event: token   data: { "token": "…" }
  //   event: done    data: { "conversationId":"…", "model":"…", "tokens":{…} }
  //   event: error   data: { "error": "…" }
  fastify.post("/chat/stream", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware],
  }, async (request, reply) => {
    const body           = typeof request.body === "object" && request.body ? request.body : {};
    const agentId        = body.agentId        ? String(body.agentId).trim()        : "";
    const message        = body.message        ? String(body.message).trim()        : "";
    const conversationId = body.conversationId ? String(body.conversationId).trim() : null;
    const model          = body.model          ? String(body.model).trim()          : null;
    const temperature    = body.temperature    != null ? Number(body.temperature)   : null;
    const maxTokens      = body.maxTokens      != null ? Number(body.maxTokens)     : null;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!agentId) return reply.code(400).send({ error: "agentId is required" });
    if (!message) return reply.code(400).send({ error: "message is required" });

    // ── Load agent ────────────────────────────────────────────────────────────
    const agent = await loadAgent(agentId, request.organizationId);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    // ── Resolve conversation (must happen BEFORE hijack) ──────────────────────
    const { conv, created } = await resolveConversation(
      conversationId, agentId, request.organizationId, request.userId
    );
    if (!conv) return reply.code(404).send({ error: "conversationId not found for this agent" });

    // ── Model priority ────────────────────────────────────────────────────────
    const resolvedModel = model || agent.model || null;
    process.stdout.write(
      `[v1:stream] agentId=${agentId} conv=${conv.id} model=${resolvedModel ?? selectModel("chat")}\n`
    );

    // ── Hijack for SSE ────────────────────────────────────────────────────────
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      "Content-Type":                "text/event-stream; charset=utf-8",
      "Cache-Control":               "no-cache, no-transform",
      "Connection":                  "keep-alive",
      "X-Accel-Buffering":           "no",
      "Access-Control-Allow-Origin": request.headers.origin || "*",
    });

    // Convenience: write a named SSE event
    let streamEnded = false;
    const ollamaAbort = new AbortController();

    function send(event, data) {
      if (!streamEnded) {
        try { raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignore */ }
      }
    }

    // Hard timeout — prevents hung connections
    const timeoutId = setTimeout(() => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaAbort.abort();
        send("error", { error: "Stream timeout (60 s)" });
        raw.end();
      }
    }, STREAM_TIMEOUT_MS);

    // Client disconnect
    request.raw.on("close", () => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaAbort.abort();
        clearTimeout(timeoutId);
      }
    });

    try {
      const generator = streamAgentChat({
        conversationId:  conv.id,
        message,
        organizationId:  request.organizationId,
        systemPrompt:    agent.rules?.trim() || null,
        model:           resolvedModel,
        temperature:     temperature != null && !isNaN(temperature) ? temperature : undefined,
        maxTokens:       maxTokens   != null && !isNaN(maxTokens)   ? maxTokens   : undefined,
        signal:          ollamaAbort.signal,
      });

      for await (const chunk of generator) {
        if (streamEnded) break;
        if (chunk.done) {
          send("done", {
            conversationId: conv.id,
            model:          chunk.modelUsed,
            tokens:         chunk.tokens,
            created,
          });
        } else {
          send("token", { token: chunk.token });
        }
      }
    } catch (err) {
      request.log.error({ err }, "[v1:stream] failed");
      if (!streamEnded) send("error", { error: err.message });
    } finally {
      clearTimeout(timeoutId);
      if (!streamEnded) {
        streamEnded = true;
        raw.end();
      }
    }
  });

  // ── POST /product-photos/verify ────────────────────────────────────────────
  // Batch: URLs of images + product card → each row gets active true/false (vision).
  fastify.post("/product-photos/verify", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware],
  }, async (request, reply) => {
    const body = typeof request.body === "object" && request.body ? request.body : {};
    try {
      const out = await verifyProductPhotos({
        productName: body.productName,
        description: body.description,
        color: body.color,
        photos: body.photos,
        options: body.options,
      });
      return reply.code(200).send(out);
    } catch (err) {
      const status = err && typeof err === "object" && err.statusCode ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) {
        request.log.error({ err }, "[v1:product-photos/verify] failed");
      }
      return reply.code(status).send({ error: message });
    }
  });
};
