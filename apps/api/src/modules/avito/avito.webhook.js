"use strict";

/**
 * avito.webhook.js — Fastify plugin: all Avito HTTP routes + worker bootstrap.
 *
 * Routes registered:
 *   POST   /avito/webhook/:agentId      Public (Avito → us)
 *   GET    /avito/accounts              List org's Avito accounts
 *   POST   /avito/accounts              Create Avito account
 *   PATCH  /avito/accounts/:id          Update Avito account
 *   DELETE /avito/accounts/:id          Delete Avito account
 *   PATCH  /avito/agent/:agentId        Update avitoMode / avitoAccountId for agent
 *   GET    /avito/conversations         List Avito conversations
 *   GET    /avito/audit                 Audit log
 *   GET    /avito/chats                 Proxy: list chats (uses org's first active account)
 *   GET    /avito/chats/:chatId/messages
 *
 * Credentials priority: linked AvitoAccount (DB) → AVITO_TOKEN env (legacy).
 */

const crypto         = require("crypto");
const prisma         = require("../../lib/prisma");
const authMiddleware = require("../../middleware/auth");
const { createClient, getChats, getMessages } = require("../../services/avitoClient");
const { getAvitoQueue, startAvitoWorker }      = require("./avito.queue");
const { processAvitoJob }                       = require("./avito.processor");

// ── Signature validation ──────────────────────────────────────────────────────

/**
 * Validate Avito webhook HMAC-SHA256 signature.
 * Checks agent's linked account webhookSecret first, then AVITO_WEBHOOK_SECRET env.
 * If no secret is configured → allow all (permissive / dev mode).
 *
 * @param {object} request  Fastify request
 * @param {string|null} dbSecret  webhookSecret from AvitoAccount (if any)
 */
function validateWebhookSignature(request, dbSecret = null) {
  const secret = dbSecret || process.env.AVITO_WEBHOOK_SECRET;
  if (!secret) return true; // no secret configured → allow

  const signature = request.headers["x-avito-signature"] || "";
  if (!signature) return false;

  try {
    const rawBody  = JSON.stringify(request.body);
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected,  "hex")
    );
  } catch {
    return false;
  }
}

// ── Idempotency key ───────────────────────────────────────────────────────────

function buildEventId(event, agentId) {
  if (event?.id) return `avito_${event.id}`;
  const val = event?.payload?.value ?? {};
  const raw = `${agentId}:${val.chat_id ?? ""}:${val.id ?? ""}:${val.author_id ?? ""}`;
  return `avito_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sanitise AvitoAccount for API response — never expose accessToken in full */
function sanitiseAccount(a) {
  return {
    id:            a.id,
    organizationId: a.organizationId,
    name:          a.name,
    accountId:     a.accountId,
    isActive:      a.isActive,
    hasToken:      Boolean(a.accessToken),
    hasWebhookSecret: Boolean(a.webhookSecret),
    createdAt:     a.createdAt,
    updatedAt:     a.updatedAt,
  };
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

module.exports = async function avitoModule(fastify) {

  // Start BullMQ worker embedded in main API process
  startAvitoWorker(processAvitoJob);

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC
  // ══════════════════════════════════════════════════════════════════════════

  // ── POST /avito/webhook/:agentId ─────────────────────────────────────────
  fastify.post("/avito/webhook/:agentId", async (request, reply) => {
    const agentId = String(request.params.agentId ?? "").trim();
    const event   = request.body;

    // Load agent's linked account for per-account signature check
    let dbSecret = null;
    try {
      const agent = await prisma.agent.findFirst({
        where:   { id: agentId, deletedAt: null },
        include: { avitoAccount: { select: { webhookSecret: true } } },
      });
      dbSecret = agent?.avitoAccount?.webhookSecret ?? null;
    } catch { /* non-fatal */ }

    if (!validateWebhookSignature(request, dbSecret)) {
      process.stderr.write(`[avito:webhook] invalid signature agentId=${agentId}\n`);
      return reply.code(401).send({ error: "invalid signature" });
    }

    const eventId = buildEventId(event, agentId);
    process.stdout.write(
      `[avito:webhook] received eventId=${eventId} type=${event?.type ?? "?"} agentId=${agentId}\n`
    );

    // ACK immediately — Avito retries on slow responses
    reply.code(200).send({ ok: true, eventId });

    // Async processing
    setImmediate(async () => {
      try {
        const existing = await prisma.avitoWebhookEvent.findUnique({ where: { id: eventId } });
        if (existing) {
          process.stdout.write(`[avito:webhook] duplicate eventId=${eventId} — skip\n`);
          return;
        }

        if (event?.type !== "message") {
          await prisma.avitoWebhookEvent.create({
            data: { id: eventId, agentId, type: event?.type ?? "unknown", payload: event ?? {} },
          });
          process.stdout.write(`[avito:webhook] non-message type=${event?.type} — stored\n`);
          return;
        }

        const val      = event?.payload?.value ?? {};
        const chatId   = String(val.chat_id   ?? "").trim();
        const authorId = String(val.author_id ?? "").trim();
        const text     = String(val.content?.text ?? "").trim();

        if (!chatId || !text) {
          await prisma.avitoWebhookEvent.create({
            data: { id: eventId, agentId, type: "message", chatId: chatId || null, authorId: authorId || null, payload: event ?? {} },
          });
          return;
        }

        await prisma.avitoWebhookEvent.create({
          data: { id: eventId, agentId, type: "message", chatId, authorId, payload: event, queuedAt: new Date() },
        });

        const queue = getAvitoQueue();
        if (queue) {
          await queue.add("avito_message", { agentId, eventId, chatId, authorId, text, messageId: val.id ?? null }, { jobId: eventId });
          process.stdout.write(`[avito:webhook] queued job=${eventId} chatId=${chatId}\n`);
        } else {
          process.stderr.write(`[avito:webhook] Redis unavailable — processing synchronously\n`);
          await processAvitoJob({ id: eventId, data: { agentId, eventId, chatId, authorId, text } });
        }
      } catch (err) {
        process.stderr.write(`[avito:webhook] async error eventId=${eventId}: ${err.message}\n`);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AVITO ACCOUNTS CRUD
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /avito/accounts ──────────────────────────────────────────────────
  fastify.get("/avito/accounts", { preHandler: [authMiddleware] }, async (request) => {
    const rows = await prisma.avitoAccount.findMany({
      where:   { organizationId: request.organizationId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(sanitiseAccount);
  });

  // ── POST /avito/accounts ─────────────────────────────────────────────────
  fastify.post("/avito/accounts", { preHandler: [authMiddleware] }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { name, accessToken, accountId, webhookSecret, isActive } = body;

    if (!accessToken || !String(accessToken).trim()) {
      return reply.code(400).send({ error: "accessToken is required" });
    }
    if (!accountId || !String(accountId).trim()) {
      return reply.code(400).send({ error: "accountId is required" });
    }

    const account = await prisma.avitoAccount.create({
      data: {
        organizationId: request.organizationId,
        name:          name       ? String(name).trim() : null,
        accessToken:   String(accessToken).trim(),
        accountId:     String(accountId).trim(),
        webhookSecret: webhookSecret ? String(webhookSecret).trim() : null,
        isActive:      isActive !== false,
      },
    });

    process.stdout.write(`[avito:accounts] created id=${account.id} orgId=${request.organizationId}\n`);
    return sanitiseAccount(account);
  });

  // ── PATCH /avito/accounts/:id ────────────────────────────────────────────
  fastify.patch("/avito/accounts/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const accountRecordId = String(request.params.id ?? "").trim();
    const body = request.body && typeof request.body === "object" ? request.body : {};

    const existing = await prisma.avitoAccount.findFirst({
      where: { id: accountRecordId, organizationId: request.organizationId },
    });
    if (!existing) return reply.code(404).send({ error: "Avito account not found" });

    const data = {};
    if (body.name          !== undefined) data.name          = body.name ? String(body.name).trim() : null;
    if (body.accessToken   !== undefined) data.accessToken   = body.accessToken ? String(body.accessToken).trim() : existing.accessToken;
    if (body.accountId     !== undefined) data.accountId     = body.accountId ? String(body.accountId).trim() : existing.accountId;
    if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret ? String(body.webhookSecret).trim() : null;
    if (body.isActive      !== undefined) data.isActive      = Boolean(body.isActive);

    const updated = await prisma.avitoAccount.update({ where: { id: accountRecordId }, data });
    process.stdout.write(`[avito:accounts] updated id=${accountRecordId}\n`);
    return sanitiseAccount(updated);
  });

  // ── DELETE /avito/accounts/:id ───────────────────────────────────────────
  fastify.delete("/avito/accounts/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const accountRecordId = String(request.params.id ?? "").trim();

    const existing = await prisma.avitoAccount.findFirst({
      where: { id: accountRecordId, organizationId: request.organizationId },
    });
    if (!existing) return reply.code(404).send({ error: "Avito account not found" });

    // Unlink agents before deleting
    await prisma.agent.updateMany({
      where: { avitoAccountId: accountRecordId },
      data:  { avitoAccountId: null },
    });

    await prisma.avitoAccount.delete({ where: { id: accountRecordId } });
    process.stdout.write(`[avito:accounts] deleted id=${accountRecordId}\n`);
    return { ok: true };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AGENT AVITO SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  // ── PATCH /avito/agent/:agentId ──────────────────────────────────────────
  // Update avitoMode and/or avitoAccountId for an agent.
  fastify.patch("/avito/agent/:agentId", { preHandler: [authMiddleware] }, async (request, reply) => {
    const agentId = String(request.params.agentId ?? "").trim();
    const body    = request.body && typeof request.body === "object" ? request.body : {};

    if (!agentId) return reply.code(400).send({ error: "agentId is required" });

    const agent = await prisma.agent.findFirst({
      where: { id: agentId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const data = {};

    if (body.avitoMode !== undefined) {
      const VALID = ["autoreply", "copilot", "human", "off"];
      const m = body.avitoMode != null ? String(body.avitoMode).trim().toLowerCase() : null;
      if (m && !VALID.includes(m)) return reply.code(400).send({ error: `avitoMode must be one of: ${VALID.join(", ")}` });
      if (m) data.avitoMode = m;
    }

    if (body.avitoAccountId !== undefined) {
      if (body.avitoAccountId === null || body.avitoAccountId === "") {
        data.avitoAccountId = null;
      } else {
        // Verify the account belongs to this org
        const acc = await prisma.avitoAccount.findFirst({
          where: { id: String(body.avitoAccountId), organizationId: request.organizationId },
        });
        if (!acc) return reply.code(404).send({ error: "Avito account not found in this org" });
        data.avitoAccountId = acc.id;
      }
    }

    const updated = await prisma.agent.update({ where: { id: agentId }, data });
    process.stdout.write(
      `[avito:agent] updated agentId=${agentId} mode=${updated.avitoMode} accountId=${updated.avitoAccountId}\n`
    );
    return { id: updated.id, avitoMode: updated.avitoMode, avitoAccountId: updated.avitoAccountId };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // READ-ONLY MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /avito/conversations ─────────────────────────────────────────────
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

  // ── GET /avito/audit ─────────────────────────────────────────────────────
  fastify.get("/avito/audit", { preHandler: [authMiddleware] }, async (request) => {
    return prisma.avitoAuditLog.findMany({
      where:   { organizationId: request.organizationId },
      orderBy: { createdAt: "desc" },
      take:    100,
    });
  });

  // ── GET /avito/chats ─────────────────────────────────────────────────────
  // Uses first active AvitoAccount for the org, falls back to env.
  fastify.get("/avito/chats", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const acc = await prisma.avitoAccount.findFirst({
        where:   { organizationId: request.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      const client = acc
        ? createClient({ token: acc.accessToken, accountId: acc.accountId })
        : null;
      const data = client ? await client.getChats() : await getChats();
      return { chats: data.chats ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/chats/:chatId/messages ────────────────────────────────────
  fastify.get("/avito/chats/:chatId/messages", { preHandler: [authMiddleware] }, async (request, reply) => {
    const chatId = String(request.params.chatId ?? "").trim();
    if (!chatId) return reply.code(400).send({ error: "chatId is required" });
    try {
      const acc = await prisma.avitoAccount.findFirst({
        where:   { organizationId: request.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      const client = acc
        ? createClient({ token: acc.accessToken, accountId: acc.accountId })
        : null;
      const data = client ? await client.getMessages(chatId) : await getMessages(chatId);
      return { messages: data.messages ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });
};
