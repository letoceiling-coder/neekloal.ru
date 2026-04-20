"use strict";

/**
 * inbox.js — unified inbox of AgentConversation rows across all sources
 * (avito, web, telegram, …).
 *
 * Endpoints (JWT-auth, org-scoped):
 *   GET  /inbox/conversations?source=&takeover=&q=&limit=&offset=
 *   GET  /inbox/conversations/:id
 *   GET  /inbox/conversations/:id/messages
 *   POST /inbox/conversations/:id/messages   body: { text }
 *        — send a manager reply into the originating channel.
 *          Auto-activates human takeover so the AI does not race with the human.
 *          Currently implemented for source="avito"; other sources → 501.
 */

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const { createClient: createAvitoClient } = require("../services/avitoClient");
const { resolveAccountCredentials } = require("../modules/avito/avito.credentials");
const { cancelFollowUps } = require("../modules/avito/avito.followup.queue");
const { takeOverConversation } = require("../services/conversationTakeover");

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT     = 200;
const MESSAGE_MAX_CHARS  = 4000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** @param {unknown} v */
function clampPosInt(v, fallback, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}

/** @param {unknown} v */
function clampOffset(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(50_000, Math.floor(n));
}

/**
 * Extract lightweight summary (last message role/content) from JSON messages.
 * @param {unknown} messages
 */
function summarizeLastMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { role: null, snippet: "", count: 0 };
  }
  const last = messages[messages.length - 1];
  const snippet = last && typeof last.content === "string"
    ? last.content.replace(/\s+/g, " ").trim().slice(0, 200)
    : "";
  const role = last && typeof last.role === "string" ? last.role : null;
  return { role, snippet, count: messages.length };
}

function serializeRow(r) {
  const last = summarizeLastMessage(r.messages);
  const atIso = (d) => (d instanceof Date ? d.toISOString() : d);
  return {
    id:             r.id,
    agentId:        r.agentId,
    source:         r.source,
    externalId:     r.externalId,
    externalUserId: r.externalUserId,
    title:          r.title,
    messageCount:   last.count,
    lastMessage:    { role: last.role, snippet: last.snippet },
    humanTakeover: r.humanTakeoverAt
      ? {
          at:   atIso(r.humanTakeoverAt),
          by:   r.humanTakeoverByUser
            ? { id: r.humanTakeoverByUser.id, email: r.humanTakeoverByUser.email }
            : (r.humanTakeoverBy ? { id: r.humanTakeoverBy, email: null } : null),
          note: r.humanTakeoverNote,
        }
      : null,
    createdAt: atIso(r.createdAt),
    updatedAt: atIso(r.updatedAt),
  };
}

// ── Send via Avito ───────────────────────────────────────────────────────────

/**
 * Send a manager reply into the Avito chat.
 * Returns { ok: true, source } on success.
 * Throws an error with .status set on failures.
 */
async function sendAvitoReply(conv, text) {
  const agent = await prisma.agent.findFirst({
    where:   { id: conv.agentId, deletedAt: null },
    include: { avitoAccount: true },
  });
  if (!agent) {
    const e = new Error("agent not found for conversation");
    e.status = 404;
    throw e;
  }

  let client = null;
  if (agent.avitoAccount?.isActive) {
    try {
      const creds = await resolveAccountCredentials(agent.avitoAccount);
      client = createAvitoClient({ token: creds.accessToken, accountId: creds.accountId });
    } catch (e) {
      process.stderr.write(`[inbox:reply] avitoAccount invalid: ${e.message}\n`);
    }
  }
  if (!client && process.env.AVITO_TOKEN && process.env.AVITO_ACCOUNT_ID) {
    client = createAvitoClient({
      token:     process.env.AVITO_TOKEN,
      accountId: process.env.AVITO_ACCOUNT_ID,
    });
  }
  if (!client) {
    const e = new Error("Нет доступных Avito credentials для этого агента");
    e.status = 409;
    throw e;
  }
  if (!conv.externalId) {
    const e = new Error("conv.externalId (Avito chatId) is empty");
    e.status = 400;
    throw e;
  }

  await client.sendMessage(conv.externalId, text);
  return { ok: true };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function inboxRoutes(fastify) {
  // ── GET /inbox/conversations ────────────────────────────────────────────
  fastify.get(
    "/inbox/conversations",
    { preHandler: authMiddleware },
    async (request) => {
      const q = request.query && typeof request.query === "object" ? request.query : {};
      const limit  = clampPosInt(q.limit,  LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
      const offset = clampOffset(q.offset);

      /** @type {import('@prisma/client').Prisma.AgentConversationWhereInput} */
      const where = { organizationId: request.organizationId };

      if (typeof q.source === "string" && q.source.trim()) {
        where.source = String(q.source).trim().toLowerCase();
      }
      if (q.takeover === "true" || q.takeover === true || q.takeover === "1") {
        where.humanTakeoverAt = { not: null };
      } else if (q.takeover === "false" || q.takeover === false || q.takeover === "0") {
        where.humanTakeoverAt = null;
      }
      if (typeof q.q === "string" && q.q.trim()) {
        const needle = q.q.trim();
        where.OR = [
          { externalId:     { contains: needle, mode: "insensitive" } },
          { externalUserId: { contains: needle, mode: "insensitive" } },
          { title:          { contains: needle, mode: "insensitive" } },
        ];
      }

      const [total, rows] = await Promise.all([
        prisma.agentConversation.count({ where }),
        prisma.agentConversation.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take:    limit,
          skip:    offset,
          include: { humanTakeoverByUser: { select: { id: true, email: true } } },
        }),
      ]);

      return {
        total,
        limit,
        offset,
        items: rows.map(serializeRow),
      };
    }
  );

  // ── GET /inbox/conversations/:id ────────────────────────────────────────
  fastify.get(
    "/inbox/conversations/:id",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      const row = await prisma.agentConversation.findFirst({
        where:  { id, organizationId: request.organizationId },
        include: { humanTakeoverByUser: { select: { id: true, email: true } } },
      });
      if (!row) return reply.code(404).send({ error: "conversation not found" });

      return serializeRow(row);
    }
  );

  // ── GET /inbox/conversations/:id/messages ───────────────────────────────
  fastify.get(
    "/inbox/conversations/:id/messages",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      const row = await prisma.agentConversation.findFirst({
        where:  { id, organizationId: request.organizationId },
        select: { id: true, messages: true, source: true, externalId: true },
      });
      if (!row) return reply.code(404).send({ error: "conversation not found" });

      const msgs = Array.isArray(row.messages) ? row.messages : [];
      return {
        conversationId: row.id,
        source:         row.source,
        externalId:     row.externalId,
        messages:       msgs,
      };
    }
  );

  // ── POST /inbox/conversations/:id/messages ──────────────────────────────
  fastify.post(
    "/inbox/conversations/:id/messages",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return reply.code(400).send({ error: "text is required" });
      if (text.length > MESSAGE_MAX_CHARS) {
        return reply.code(400).send({ error: `text too long (max ${MESSAGE_MAX_CHARS})` });
      }

      const conv = await prisma.agentConversation.findFirst({
        where: { id, organizationId: request.organizationId },
      });
      if (!conv) return reply.code(404).send({ error: "conversation not found" });

      // ── 1. Dispatch to the proper channel ────────────────────────────────
      try {
        if (conv.source === "avito") {
          await sendAvitoReply(conv, text);
        } else {
          return reply.code(501).send({
            error: `Manager reply is not implemented for source="${conv.source}" yet`,
          });
        }
      } catch (err) {
        const status = err && err.status ? err.status : 502;
        return reply.code(status).send({ error: err.message || "channel send failed" });
      }

      // ── 2. Auto-takeover so AI does not race with the human ─────────────
      try {
        if (!conv.humanTakeoverAt) {
          await takeOverConversation({
            conversationId: conv.id,
            organizationId: request.organizationId,
            userId:         request.userId,
            note:           "Автоматически: менеджер ответил из админки",
          });
        } else if (conv.source === "avito" && conv.externalId) {
          // Already on takeover — still make sure no pending follow-ups wake up the AI.
          await cancelFollowUps({
            agentId: conv.agentId,
            chatId:  conv.externalId,
            reason:  "manager_reply",
          });
        }
      } catch (err) {
        process.stderr.write(
          `[inbox:reply] takeover/cancel follow-up failed conv=${conv.id}: ${err.message}\n`
        );
      }

      // ── 3. Append the manager message to conversation history ───────────
      const current = Array.isArray(conv.messages) ? conv.messages : [];
      const now = new Date().toISOString();
      const entry = {
        role:     "assistant",
        author:   "human",
        userId:   request.userId,
        content:  text,
        sentAt:   now,
      };
      const updated = await prisma.agentConversation.update({
        where: { id: conv.id },
        data:  { messages: [...current, entry] },
        include: { humanTakeoverByUser: { select: { id: true, email: true } } },
      });

      return {
        ok:           true,
        message:      entry,
        conversation: serializeRow(updated),
      };
    }
  );
};
