"use strict";

/**
 * routes/avito.js — DEPRECATED (V1).
 * Replaced by: src/modules/avito/avito.webhook.js (V2 with BullMQ + audit + CRM)
 * This file is NO LONGER REGISTERED in app.js.
 *
 * routes/avito.js — Avito Messenger webhook + management endpoints.
 *
 * Webhook URL pattern (set in Avito developer console):
 *   https://site-al.ru/api/avito/webhook/<agentId>
 *
 * Event flow:
 *   Avito sends POST → parse event → find/create AgentConversation
 *   → call agentChatV2 → send AI reply via avitoClient
 *
 * Env required:
 *   AVITO_TOKEN       — OAuth bearer token
 *   AVITO_ACCOUNT_ID  — numeric Avito account id (to skip own messages)
 */

const prisma                          = require("../lib/prisma");
const { agentChatV2,
        findOrCreateExternalConversation } = require("../services/agentRuntimeV2");
const { sendMessage, getChats, getMessages } = require("../services/avitoClient");
const authMiddleware                  = require("../middleware/auth");

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Core event processor — runs async after the 200 ACK.
 */
async function handleAvitoEvent(agentId, event) {
  // Only handle incoming text messages
  if (!event || event.type !== "message") return;

  const val = event.payload?.value;
  if (!val) return;

  const chatId        = String(val.chat_id    ?? "").trim();
  const authorId      = String(val.author_id  ?? "").trim();
  const text          = String(val.content?.text ?? "").trim();
  const msgType       = val.type ?? "text";

  if (!chatId) {
    process.stdout.write("[avito:webhook] skip: missing chat_id\n");
    return;
  }
  if (!text) {
    process.stdout.write(`[avito:webhook] skip: no text content (type=${msgType}) chatId=${chatId}\n`);
    return;
  }

  // Skip messages sent by the bot itself
  const myAccountId = process.env.AVITO_ACCOUNT_ID;
  if (myAccountId && String(authorId) === String(myAccountId)) {
    process.stdout.write(`[avito:webhook] skip: own message chatId=${chatId}\n`);
    return;
  }

  process.stdout.write(
    `[avito:webhook] agentId=${agentId} chatId=${chatId} from=${authorId} text="${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"\n`
  );

  // Load agent
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, deletedAt: null },
  });
  if (!agent) {
    process.stderr.write(`[avito:error] agent not found: ${agentId}\n`);
    return;
  }

  // Find or create persistent conversation for this Avito chat
  const conv = await findOrCreateExternalConversation(
    agentId,
    agent.organizationId,
    chatId,
    authorId,
    "avito"
  );

  // System prompt: agent rules (if any)
  const systemPrompt = agent.rules?.trim() || null;

  // Generate AI reply
  let result;
  try {
    result = await agentChatV2({
      conversationId: conv.id,
      message:        text,
      organizationId: agent.organizationId,
      systemPrompt,
      model: agent.model || null,
    });
  } catch (err) {
    process.stderr.write(`[avito:error] agentChatV2 failed: ${err.message}\n`);
    return;
  }

  process.stdout.write(
    `[avito:webhook] ai reply model=${result.modelUsed} chars=${result.reply.length}\n`
  );

  // Send reply back to Avito (respect autoReply flag)
  if (agent.autoReply === false) {
    process.stdout.write(
      `[avito:webhook] autoReply=false — reply saved to DB but NOT sent to Avito chatId=${chatId}\n`
    );
    return;
  }

  try {
    await sendMessage(chatId, result.reply);
  } catch (err) {
    process.stderr.write(`[avito:error] sendMessage chatId=${chatId}: ${err.message}\n`);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

module.exports = async function avitoRoutes(fastify) {

  // ── POST /avito/webhook/:agentId ─────────────────────────────────────────
  // Public endpoint — no JWT auth (Avito calls it).
  // Responds 200 immediately, then processes async (avoids Avito retries).
  fastify.post("/avito/webhook/:agentId", async (request, reply) => {
    const agentId = String(request.params.agentId ?? "").trim();
    const event   = request.body;

    process.stdout.write(
      `[avito:webhook] received type=${event?.type ?? "unknown"} agentId=${agentId}\n`
    );

    // ACK immediately — Avito requires fast response
    reply.code(200).send({ ok: true });

    // Process in next tick — non-blocking
    setImmediate(() => {
      handleAvitoEvent(agentId, event).catch((err) =>
        process.stderr.write(`[avito:error] unhandled: ${err.message}\n`)
      );
    });
  });

  // ── GET /avito/chats ──────────────────────────────────────────────────────
  // Management: list Avito chats (requires JWT auth).
  fastify.get("/avito/chats", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const data = await getChats();
      return { chats: data.chats ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/chats/:chatId/messages ─────────────────────────────────────
  // Management: list messages in a specific Avito chat.
  fastify.get("/avito/chats/:chatId/messages", { preHandler: [authMiddleware] }, async (request, reply) => {
    const chatId = String(request.params.chatId ?? "").trim();
    if (!chatId) return reply.code(400).send({ error: "chatId is required" });
    try {
      const data = await getMessages(chatId);
      return { messages: data.messages ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/conversations ──────────────────────────────────────────────
  // Management: list all Avito-sourced AgentConversations in the org.
  fastify.get("/avito/conversations", { preHandler: [authMiddleware] }, async (request) => {
    const rows = await prisma.agentConversation.findMany({
      where:   { organizationId: request.organizationId, source: "avito" },
      orderBy: { updatedAt: "desc" },
      take:    200,
    });
    return rows.map((r) => ({
      id:             r.id,
      agentId:        r.agentId,
      chatId:         r.externalId,
      externalUserId: r.externalUserId,
      title:          r.title,
      messageCount:   Array.isArray(r.messages) ? r.messages.length : 0,
      createdAt:      r.createdAt,
      updatedAt:      r.updatedAt,
    }));
  });
};
