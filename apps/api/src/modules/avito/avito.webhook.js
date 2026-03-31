"use strict";

/**
 * avito.webhook.js — Fastify plugin: all Avito HTTP routes + worker bootstrap.
 *
 * Routes registered:
 *   POST /avito/webhook/:agentId    Public (Avito → us)
 *   GET  /avito/chats               Auth-required management
 *   GET  /avito/chats/:chatId/messages
 *   GET  /avito/conversations       Auth-required management
 *   GET  /avito/audit               Auth-required: last 100 audit logs
 *   PATCH /avito/agent/:agentId     Auth-required: update avitoMode
 *
 * This file REPLACES routes/avito.js entirely.
 * app.js must register this module instead of routes/avito.
 */

const crypto         = require("crypto");
const prisma         = require("../../lib/prisma");
const authMiddleware = require("../../middleware/auth");
const { getChats, getMessages } = require("../../services/avitoClient");
const { getAvitoQueue, startAvitoWorker } = require("./avito.queue");
const { processAvitoJob }                 = require("./avito.processor");

// ── Signature validation ──────────────────────────────────────────────────────

/**
 * Validate Avito webhook request.
 * If AVITO_WEBHOOK_SECRET is not configured → allow all (dev mode).
 *
 * Avito sends an HMAC-SHA256 signature in X-Avito-Signature header
 * over the raw request body.
 */
function validateWebhookSignature(request) {
  const secret = process.env.AVITO_WEBHOOK_SECRET;
  if (!secret) return true; // permissive if not configured

  const signature = request.headers["x-avito-signature"] || "";
  if (!signature) return false;

  try {
    const rawBody    = JSON.stringify(request.body); // re-serialize (body already parsed)
    const expected   = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

// ── Idempotency key ───────────────────────────────────────────────────────────

function buildEventId(event, agentId) {
  if (event?.id) return `avito_${event.id}`;
  // Fallback: hash key from available fields
  const val = event?.payload?.value ?? {};
  const raw = `${agentId}:${val.chat_id ?? ""}:${val.id ?? ""}:${val.author_id ?? ""}`;
  return `avito_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

module.exports = async function avitoModule(fastify) {

  // Start BullMQ worker (once, embedded in API process)
  startAvitoWorker(processAvitoJob);

  // ── POST /avito/webhook/:agentId ────────────────────────────────────────
  // Public — Avito calls this. No JWT, but optional HMAC signature check.
  // Responds 200 immediately; processing happens in BullMQ.
  fastify.post("/avito/webhook/:agentId", async (request, reply) => {
    const agentId = String(request.params.agentId ?? "").trim();
    const event   = request.body;

    // ── Signature validation ──────────────────────────────────────────────
    if (!validateWebhookSignature(request)) {
      process.stderr.write(`[avito:webhook] invalid signature agentId=${agentId}\n`);
      return reply.code(401).send({ error: "invalid signature" });
    }

    const eventId = buildEventId(event, agentId);

    process.stdout.write(
      `[avito:webhook] received eventId=${eventId} type=${event?.type ?? "?"} agentId=${agentId}\n`
    );

    // Always ACK first — Avito retries if response is slow
    reply.code(200).send({ ok: true, eventId });

    // ── Async processing (non-blocking) ───────────────────────────────────
    setImmediate(async () => {
      try {
        // ── Idempotency: skip duplicate events ──────────────────────────
        const existing = await prisma.avitoWebhookEvent.findUnique({
          where: { id: eventId },
        });
        if (existing) {
          process.stdout.write(`[avito:webhook] duplicate eventId=${eventId} — skip\n`);
          return;
        }

        // Only queue text messages
        if (event?.type !== "message") {
          await prisma.avitoWebhookEvent.create({
            data: {
              id:      eventId,
              agentId,
              type:    event?.type ?? "unknown",
              payload: event ?? {},
            },
          });
          process.stdout.write(`[avito:webhook] non-message event type=${event?.type} — stored, not queued\n`);
          return;
        }

        const val      = event?.payload?.value ?? {};
        const chatId   = String(val.chat_id   ?? "").trim();
        const authorId = String(val.author_id ?? "").trim();
        const text     = String(val.content?.text ?? "").trim();

        if (!chatId || !text) {
          await prisma.avitoWebhookEvent.create({
            data: {
              id:      eventId,
              agentId,
              type:    event?.type ?? "message",
              chatId:  chatId  || null,
              authorId: authorId || null,
              payload: event ?? {},
            },
          });
          process.stdout.write(`[avito:webhook] skip: missing chatId or text eventId=${eventId}\n`);
          return;
        }

        // ── Save event (idempotency record) ──────────────────────────────
        await prisma.avitoWebhookEvent.create({
          data: {
            id:       eventId,
            agentId,
            type:     "message",
            chatId,
            authorId,
            payload:  event,
            queuedAt: new Date(),
          },
        });

        // ── Enqueue job ───────────────────────────────────────────────────
        const queue = getAvitoQueue();
        if (queue) {
          await queue.add("avito_message", {
            agentId,
            eventId,
            chatId,
            authorId,
            text,
            messageId: val.id ?? null,
          }, {
            jobId: eventId, // BullMQ deduplication by jobId
          });
          process.stdout.write(`[avito:webhook] queued job=${eventId} chatId=${chatId}\n`);
        } else {
          // Fallback: synchronous processing if Redis unavailable
          process.stderr.write(`[avito:webhook] Redis unavailable — processing synchronously\n`);
          const { processAvitoJob: proc } = require("./avito.processor");
          await proc({ id: eventId, data: { agentId, eventId, chatId, authorId, text } });
        }
      } catch (err) {
        process.stderr.write(`[avito:webhook] async error eventId=${eventId}: ${err.message}\n`);
      }
    });
  });

  // ── GET /avito/chats ──────────────────────────────────────────────────────
  fastify.get("/avito/chats", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const data = await getChats();
      return { chats: data.chats ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/chats/:chatId/messages ─────────────────────────────────────
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

  // ── GET /avito/audit ──────────────────────────────────────────────────────
  // Last 100 audit log entries for the org (reverse-chrono).
  fastify.get("/avito/audit", { preHandler: [authMiddleware] }, async (request) => {
    const rows = await prisma.avitoAuditLog.findMany({
      where:   { organizationId: request.organizationId },
      orderBy: { createdAt: "desc" },
      take:    100,
    });
    return rows;
  });

  // ── PATCH /avito/agent/:agentId ───────────────────────────────────────────
  // Update avitoMode for a specific agent.
  fastify.patch("/avito/agent/:agentId", { preHandler: [authMiddleware] }, async (request, reply) => {
    const agentId   = String(request.params.agentId ?? "").trim();
    const body      = request.body && typeof request.body === "object" ? request.body : {};
    const avitoMode = body.avitoMode != null ? String(body.avitoMode).trim().toLowerCase() : null;

    if (!agentId) return reply.code(400).send({ error: "agentId is required" });

    const VALID_MODES = ["autoreply", "copilot", "human", "off"];
    if (avitoMode && !VALID_MODES.includes(avitoMode)) {
      return reply.code(400).send({ error: `avitoMode must be one of: ${VALID_MODES.join(", ")}` });
    }

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const data = {};
    if (avitoMode) data.avitoMode = avitoMode;

    const updated = await prisma.agent.update({
      where: { id: agentId },
      data,
    });

    process.stdout.write(`[avito:webhook] agent ${agentId} avitoMode → ${updated.avitoMode}\n`);
    return { id: updated.id, avitoMode: updated.avitoMode };
  });
};
