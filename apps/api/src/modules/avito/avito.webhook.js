"use strict";

/**
 * avito.webhook.js — Fastify plugin: all Avito HTTP routes + worker bootstrap.
 *
 * Routes registered:
 *   POST   /avito/webhook/:agentId      Public (Avito → us)
 *   GET /avito/webhook/:agentId         Logged 405 (HEAD follows GET in Fastify — same handler)
 *   POST   /incoming/:agentId           Alias (stealth; nginx: /api/incoming/… → /incoming/…)
 *   GET /incoming/:agentId              Logged 405 (+ implicit HEAD)
 *
 * Logs: append to AVITO_LOG_DIR/avito.log (default /var/www/site-al.ru/logs/avito.log).
 * Lines: webhook-post, webhook-accepted, webhook-signature-reject, webhook-wrong-method.
 * Verbose dump: set AVITO_WEBHOOK_LOG_FULL=1 (adds webhook-post-full with redacted headers).
 *   GET    /avito/accounts              List org's Avito accounts
 *   POST   /avito/accounts              Create Avito account
 *   PATCH  /avito/accounts/:id          Update Avito account
 *   DELETE /avito/accounts/:id          Delete Avito account
 *   PATCH  /avito/agent/:agentId        Update avitoMode / avitoAccountId for agent
 *   GET    /avito/conversations         List Avito conversations
 *   GET    /avito/audit                 Audit log
 *   GET    /avito/chats                 Proxy: list chats (uses org's first active account)
 *   GET    /avito/chats/:chatId/messages
 *   POST   /avito/sync                  Sync chats from Avito API
 *   GET    /avito/dialogs               DB convs + live Avito chats
 *   POST   /avito/test-send             Send a test message
 *   GET    /avito/token-check           Validate token against Avito API
 *   POST   /avito/messenger/register-webhook  Register URL at Avito (POST …/messenger/v3/webhook)
 *
 * Credentials priority: linked AvitoAccount (DB) → AVITO_TOKEN env (legacy).
 * Public webhook URL base: env AVITO_INCOMING_WEBHOOK_BASE or PUBLIC_WEBHOOK_BASE (default https://site-al.ru/api/incoming).
 */

const crypto         = require("crypto");
const EventEmitter   = require("events");
const fs             = require("fs");
const path           = require("path");
const prisma         = require("../../lib/prisma");
const authMiddleware = require("../../middleware/auth");
const {
  getChats,
  getMessages,
  getAppAccessToken,
  getSelfAccount,
  registerMessengerV3Webhook,
  listMessengerWebhookSubscriptions,
} = require("../../services/avitoClient");
const { createClientForAccount, resolveAccountCredentials } = require("./avito.credentials");
const { getAvitoQueue, startAvitoWorker }      = require("./avito.queue");
const { processAvitoJob }                       = require("./avito.processor");

// ── Webhook file log ──────────────────────────────────────────────────────────

const AVITO_LOG_DIR  = process.env.AVITO_LOG_DIR ?? "/var/www/site-al.ru/logs";
const AVITO_LOG_FILE = path.join(AVITO_LOG_DIR, "avito.log");
/** If true, append full (redacted) headers + body to avito.log for each POST (verbose; for debugging only). */
const AVITO_WEBHOOK_LOG_FULL = /^1|true|yes$/i.test(String(process.env.AVITO_WEBHOOK_LOG_FULL ?? ""));
const avitoRealtimeBus = new EventEmitter();
avitoRealtimeBus.setMaxListeners(200);
const webhookStatusByOrg = new Map();

function ensureWebhookStatus(orgId) {
  if (!orgId) return null;
  if (!webhookStatusByOrg.has(orgId)) {
    webhookStatusByOrg.set(orgId, {
      lastEventTime: null,
      lastChatId: null,
      deliveryStatus: "unknown",
      invalidSignatureCount: 0,
    });
  }
  return webhookStatusByOrg.get(orgId);
}

function updateWebhookStatus(orgId, patch) {
  const status = ensureWebhookStatus(orgId);
  if (!status) return null;
  Object.assign(status, patch);
  avitoRealtimeBus.emit("status", { type: "status", organizationId: orgId, ...status });
  return status;
}

function appendAvitoLog(data) {
  try {
    if (!fs.existsSync(AVITO_LOG_DIR)) fs.mkdirSync(AVITO_LOG_DIR, { recursive: true });
    fs.appendFileSync(AVITO_LOG_FILE, `[${new Date().toISOString()}] ${JSON.stringify(data)}\n`);
  } catch { /* non-fatal */ }
}

function redactHeadersForLog(headers) {
  if (!headers || typeof headers !== "object") return {};
  const drop = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (drop.has(String(k).toLowerCase())) out[k] = "[redacted]";
    else out[k] = v;
  }
  return out;
}

/** Avito V3 webhook часто кладёт тип в payload.type, а не в корень event.type */
function avitoWebhookEventType(event) {
  return event?.type ?? event?.payload?.type ?? null;
}

/**
 * Сообщение в чате (нужна очередь processAvitoJob). V3: только payload.value без корневого type.
 */
function isAvitoInboundChatMessageEvent(event) {
  const t = avitoWebhookEventType(event);
  if (t === "message") return true;
  const val = event?.payload?.value ?? {};
  const chatId = val.chat_id != null ? String(val.chat_id).trim() : "";
  const msgId = val.id != null ? String(val.id).trim() : "";
  const text = String(val.content?.text ?? "").trim();
  if (t != null && t !== "message") return false;
  return Boolean(chatId && msgId && text);
}

function summarizeAvitoWebhookEvent(event) {
  const val = event?.payload?.value ?? {};
  const text = String(val.content?.text ?? "");
  return {
    eventType: avitoWebhookEventType(event),
    chatId: val.chat_id != null ? String(val.chat_id) : null,
    authorId: val.author_id != null ? String(val.author_id) : null,
    messageId: val.id != null ? String(val.id) : null,
    textLen: text.length,
    textPreview: text.length ? text.slice(0, 200) : null,
  };
}

// ── Signature validation ──────────────────────────────────────────────────────

/**
 * Validate Avito webhook HMAC-SHA256 signature.
 * Checks agent's linked account webhookSecret first, then AVITO_WEBHOOK_SECRET env.
 * If no secret is configured → allow all (permissive / dev mode).
 *
 * @param {object} request  Fastify request
 * @param {string|null} dbSecret  webhookSecret from AvitoAccount (if any)
 * @returns {{ ok: boolean, detail: string, secretSource: "none"|"account"|"env" }}
 */
function checkWebhookSignature(request, dbSecret = null) {
  const fromAccount = Boolean(dbSecret);
  const fromEnv = Boolean(process.env.AVITO_WEBHOOK_SECRET);
  const secret = dbSecret || process.env.AVITO_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: true, detail: "no_secret_configured", secretSource: "none" };
  }

  const signature =
    request.headers["x-avito-signature"] ||
    request.headers["X-Avito-Signature"] ||
    "";
  if (!signature) {
    return { ok: false, detail: "missing_x_avito_signature", secretSource: fromAccount ? "account" : "env" };
  }

  try {
    const rawBody = JSON.stringify(request.body);
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const ok = crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
    return {
      ok,
      detail: ok ? "ok" : "hmac_mismatch",
      secretSource: fromAccount ? "account" : "env",
    };
  } catch {
    return { ok: false, detail: "signature_compare_error", secretSource: fromAccount ? "account" : "env" };
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
    hasAppCredentials: Boolean(a.clientId && a.clientSecret),
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

  // Shared handler — used by both /avito/webhook/:agentId and /incoming/:agentId
  async function handleWebhook(request, reply) {
    const agentId = String(request.params.agentId ?? "").trim();
    const event   = request.body;
    const summary = summarizeAvitoWebhookEvent(event);
    const sigHeader =
      request.headers["x-avito-signature"] ||
      request.headers["X-Avito-Signature"] ||
      "";

    // Load agent's linked account for per-account signature check
    let dbSecret = null;
    let agentOrgId = null;
    try {
      const agent = await prisma.agent.findFirst({
        where:   { id: agentId, deletedAt: null },
        select: {
          organizationId: true,
          avitoAccount: { select: { webhookSecret: true } },
        },
      });
      dbSecret = agent?.avitoAccount?.webhookSecret ?? null;
      agentOrgId = agent?.organizationId ?? null;
    } catch { /* non-fatal */ }

    const sigCheck = checkWebhookSignature(request, dbSecret);

    // ── Structured webhook log (always) — grep: "webhook-post" / "webhook-signature-reject" ──
    appendAvitoLog({
      type: "webhook-post",
      agentId,
      ip: request.ip,
      url: request.url,
      userAgent: String(request.headers["user-agent"] ?? ""),
      hasSignatureHeader: Boolean(sigHeader),
      signatureDetail: sigCheck.detail,
      secretSource: sigCheck.secretSource,
      ...summary,
    });
    if (AVITO_WEBHOOK_LOG_FULL) {
      appendAvitoLog({
        type: "webhook-post-full",
        agentId,
        headers: redactHeadersForLog(request.headers),
        body: event,
      });
    }

    process.stdout.write(
      `[avito:webhook] POST agent=${agentId} type=${summary.eventType ?? "?"} chat=${summary.chatId ?? "-"} ` +
        `sig=${sigHeader ? "present" : "absent"} secret=${sigCheck.secretSource} check=${sigCheck.detail}\n`
    );

    if (!sigCheck.ok) {
      appendAvitoLog({
        type: "webhook-signature-reject",
        agentId,
        detail: sigCheck.detail,
        secretSource: sigCheck.secretSource,
        ...summary,
      });
      process.stderr.write(
        `[avito:webhook] invalid signature agentId=${agentId} detail=${sigCheck.detail} secret=${sigCheck.secretSource}\n`
      );
      const prev = ensureWebhookStatus(agentOrgId);
      updateWebhookStatus(agentOrgId, {
        lastEventTime: new Date().toISOString(),
        deliveryStatus: "error",
        invalidSignatureCount: (prev?.invalidSignatureCount ?? 0) + 1,
      });
      return reply.code(401).send({ error: "invalid signature" });
    }

    const eventId = buildEventId(event, agentId);
    appendAvitoLog({
      type: "webhook-accepted",
      agentId,
      eventId,
      ...summary,
    });
    process.stdout.write(
      `[avito:webhook] accepted eventId=${eventId} type=${avitoWebhookEventType(event) ?? "?"} agentId=${agentId}\n`
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

        if (!isAvitoInboundChatMessageEvent(event)) {
          await prisma.avitoWebhookEvent.create({
            data: { id: eventId, agentId, type: avitoWebhookEventType(event) ?? "unknown", payload: event ?? {} },
          });
          process.stdout.write(
            `[avito:webhook] non-message type=${avitoWebhookEventType(event) ?? "undefined"} — stored\n`
          );
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
        updateWebhookStatus(agentOrgId, {
          lastEventTime: new Date().toISOString(),
          lastChatId: chatId,
        });
        avitoRealtimeBus.emit("message", {
          type: "message",
          eventId,
          organizationId: agentOrgId,
          agentId,
          chatId,
          authorId,
          timestamp: Date.now(),
        });

        const queue = getAvitoQueue();
        if (queue) {
          await queue.add("avito_message", { agentId, eventId, chatId, authorId, text, messageId: val.id ?? null }, { jobId: eventId });
          process.stdout.write(`[avito:webhook] queued job=${eventId} chatId=${chatId}\n`);
          updateWebhookStatus(agentOrgId, { deliveryStatus: "ok" });
        } else {
          process.stderr.write(`[avito:webhook] Redis unavailable — processing synchronously\n`);
          await processAvitoJob({ id: eventId, data: { agentId, eventId, chatId, authorId, text } });
          updateWebhookStatus(agentOrgId, { deliveryStatus: "ok" });
        }
      } catch (err) {
        process.stderr.write(`[avito:webhook] async error eventId=${eventId}: ${err.message}\n`);
        updateWebhookStatus(agentOrgId, {
          lastEventTime: new Date().toISOString(),
          deliveryStatus: "error",
        });
      }
    });
  }

  // GET (и HEAD через цепочку Fastify) — браузер / боты; лог и 405. Явный HEAD не регистрируем: дублирует маршрут GET.
  async function logWebhookWrongMethod(request, reply) {
    const agentId = String(request.params.agentId ?? "").trim();
    appendAvitoLog({
      type: "webhook-wrong-method",
      method: request.method,
      agentId,
      url: request.url,
      ip: request.ip,
      userAgent: String(request.headers["user-agent"] ?? ""),
    });
    process.stdout.write(
      `[avito:webhook] ${request.method} ${request.url} agent=${agentId} — Avito uses POST JSON; browser check is not a webhook.\n`
    );
    if (request.method === "HEAD") {
      return reply.code(405).header("Allow", "POST").send();
    }
    return reply
      .code(405)
      .header("Allow", "POST")
      .send({
        error: "Method Not Allowed",
        hint: "Webhook Avito — это POST с JSON-телом. Проверка через браузер шлёт GET и не доставляет события.",
      });
  }

  // ── POST /avito/webhook/:agentId ─────────────────────────────────────────
  // Legacy URL — kept for backward compatibility (existing Avito console configs)
  fastify.get("/avito/webhook/:agentId", logWebhookWrongMethod);
  fastify.post("/avito/webhook/:agentId", handleWebhook);

  // ── POST /incoming/:agentId ──────────────────────────────────────────────
  // Stealth alias — same logic, no "avito" keyword in URL (avoids external blocking)
  fastify.get("/incoming/:agentId", logWebhookWrongMethod);
  fastify.post("/incoming/:agentId", handleWebhook);

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

  fastify.get("/avito/webhook-status", { preHandler: [authMiddleware] }, async (request) => {
    return ensureWebhookStatus(request.organizationId) ?? {
      lastEventTime: null,
      lastChatId: null,
      deliveryStatus: "unknown",
      invalidSignatureCount: 0,
    };
  });

  // ── GET /avito/events/stream ─────────────────────────────────────────────
  // Webhook-driven live updates (SSE) for UI; avoids aggressive polling.
  fastify.get("/avito/events/stream", { preHandler: [authMiddleware] }, async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.hijack();

    const orgId = request.organizationId;
    const push = (event) => {
      try {
        if (!event?.organizationId || event.organizationId !== orgId) return;
        const eventName = event.type === "status" ? "status" : "message";
        reply.raw.write(`event: ${eventName}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch { /* ignore broken pipes */ }
    };

    const keepAliveTimer = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch { /* ignore */ }
    }, 25_000);

    avitoRealtimeBus.on("message", push);
    avitoRealtimeBus.on("status", push);
    reply.raw.write(`event: ready\ndata: {"ok":true}\n\n`);

    request.raw.on("close", () => {
      clearInterval(keepAliveTimer);
      avitoRealtimeBus.off("message", push);
      avitoRealtimeBus.off("status", push);
    });
  });

  // ── POST /avito/accounts ─────────────────────────────────────────────────
  fastify.post("/avito/accounts", { preHandler: [authMiddleware] }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { name, accessToken, accountId, clientId, clientSecret, webhookSecret, isActive } = body;
    const providedAccessToken = String(accessToken ?? "").trim();
    const providedAccountId = String(accountId ?? "").trim();
    const providedClientId = String(clientId ?? "").trim();
    const providedClientSecret = String(clientSecret ?? "").trim();
    const hasAppCreds = Boolean(providedClientId && providedClientSecret);

    let resolvedAccessToken = providedAccessToken;
    let resolvedAccountId = providedAccountId;
    let accessTokenExpiresAt = null;

    if (hasAppCreds) {
      const tokenData = await getAppAccessToken({
        clientId: providedClientId,
        clientSecret: providedClientSecret,
      });
      resolvedAccessToken = tokenData.accessToken;
      accessTokenExpiresAt = new Date(Date.now() + Math.max(tokenData.expiresIn - 30, 30) * 1000);
      const self = await getSelfAccount(resolvedAccessToken);
      resolvedAccountId = self.id;
    }

    if (!resolvedAccessToken) {
      return reply.code(400).send({ error: "Provide accessToken OR clientId+clientSecret" });
    }
    if (!resolvedAccountId) {
      return reply.code(400).send({ error: "accountId is required (or provide clientId+clientSecret for auto-resolve)" });
    }

    const account = await prisma.avitoAccount.create({
      data: {
        organizationId: request.organizationId,
        name:          name       ? String(name).trim() : null,
        accessToken:   resolvedAccessToken,
        accountId:     resolvedAccountId,
        clientId:      providedClientId || null,
        clientSecret:  providedClientSecret || null,
        accessTokenExpiresAt,
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
    if (body.clientId      !== undefined) data.clientId      = body.clientId ? String(body.clientId).trim() : null;
    if (body.clientSecret  !== undefined) data.clientSecret  = body.clientSecret ? String(body.clientSecret).trim() : null;
    if (body.webhookSecret !== undefined) data.webhookSecret = body.webhookSecret ? String(body.webhookSecret).trim() : null;
    if (body.isActive      !== undefined) data.isActive      = Boolean(body.isActive);

    const mergedClientId = data.clientId !== undefined ? data.clientId : existing.clientId;
    const mergedClientSecret = data.clientSecret !== undefined ? data.clientSecret : existing.clientSecret;
    if (mergedClientId && mergedClientSecret) {
      const tokenData = await getAppAccessToken({ clientId: mergedClientId, clientSecret: mergedClientSecret });
      data.accessToken = tokenData.accessToken;
      data.accessTokenExpiresAt = new Date(Date.now() + Math.max(tokenData.expiresIn - 30, 30) * 1000);
      const self = await getSelfAccount(tokenData.accessToken);
      data.accountId = self.id;
    }

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

  // ── POST /avito/messenger/register-webhook ───────────────────────────────
  // Calls Avito API to subscribe this org's incoming URL for the agent (Messenger v3).
  fastify.post("/avito/messenger/register-webhook", { preHandler: [authMiddleware] }, async (request, reply) => {
    const body    = request.body && typeof request.body === "object" ? request.body : {};
    const agentId = String(body.agentId ?? "").trim();
    if (!agentId) return reply.code(400).send({ error: "agentId is required" });

    const envBase = String(
      process.env.AVITO_INCOMING_WEBHOOK_BASE ||
        process.env.PUBLIC_WEBHOOK_BASE ||
        "https://site-al.ru/api/incoming"
    ).replace(/\/$/, "");
    const base = String(body.webhookBaseUrl ?? envBase)
      .trim()
      .replace(/\/$/, "");
    const webhookUrl = `${base}/${agentId}`;

    const agent = await prisma.agent.findFirst({
      where:   { id: agentId, organizationId: request.organizationId, deletedAt: null },
      include: { avitoAccount: true },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    if (!agent.avitoAccount) {
      return reply.code(400).send({ error: "Привяжите к агенту аккаунт Avito (Avito аккаунт в CRM)." });
    }
    const acc = agent.avitoAccount;
    if (!acc.isActive) return reply.code(400).send({ error: "Аккаунт Avito выключен (isActive=false)" });

    try {
      const { accessToken } = await resolveAccountCredentials(acc);
      const avitoResult = await registerMessengerV3Webhook(accessToken, { url: webhookUrl });

      let subscriptions = null;
      try {
        subscriptions = await listMessengerWebhookSubscriptions(accessToken);
      } catch (subErr) {
        subscriptions = { error: String(subErr?.message ?? subErr) };
      }

      appendAvitoLog({
        type: "webhook-register-api",
        agentId,
        webhookUrl,
        httpStatus: avitoResult.status,
        subscriptionsPath: subscriptions && !subscriptions.error ? subscriptions.path : null,
      });
      process.stdout.write(`[avito:register-webhook] ok agentId=${agentId} url=${webhookUrl}\n`);

      return {
        ok: true,
        webhookUrl,
        avito: avitoResult.data,
        subscriptions,
      };
    } catch (err) {
      const msg = String(err?.message ?? err);
      process.stderr.write(`[avito:register-webhook] fail agentId=${agentId}: ${msg}\n`);
      appendAvitoLog({ type: "webhook-register-api-error", agentId, webhookUrl, error: msg });
      return reply.code(502).send({ ok: false, error: msg, webhookUrl });
    }
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
        ? (await createClientForAccount(acc)).client
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
        ? (await createClientForAccount(acc)).client
        : null;
      const data = client ? await client.getMessages(chatId) : await getMessages(chatId);
      return { messages: data.messages ?? data };
    } catch (err) {
      return reply.code(502).send({ error: err.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC / SYNC ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  // ── POST /avito/sync ──────────────────────────────────────────────────────
  // Fetch live chats from Avito API and return them (no DB write, diagnostic).
  fastify.post("/avito/sync", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const acc = await prisma.avitoAccount.findFirst({
        where:   { organizationId: request.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!acc) return reply.code(400).send({ error: "Нет активных Avito аккаунтов" });

      const { client, accountId } = await createClientForAccount(acc);
      const data   = await client.getChats();
      const chats  = data.chats ?? data ?? [];

      process.stdout.write(`[avito:sync] accountId=${accountId} chats=${Array.isArray(chats) ? chats.length : "?"}\n`);
      appendAvitoLog({ type: "sync", accountId, chatsCount: Array.isArray(chats) ? chats.length : null });

      return { ok: true, accountId, chatsCount: Array.isArray(chats) ? chats.length : null, chats };
    } catch (err) {
      process.stderr.write(`[avito:sync] error: ${err.message}\n`);
      appendAvitoLog({ type: "sync", ok: false, error: err.message });
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/dialogs ────────────────────────────────────────────────────
  // Returns DB conversations + live Avito chats side-by-side (diagnostic).
  fastify.get("/avito/dialogs", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const [dbConvs, acc] = await Promise.all([
        prisma.agentConversation.findMany({
          where:   { organizationId: request.organizationId, source: "avito" },
          orderBy: { updatedAt: "desc" },
          take:    50,
        }),
        prisma.avitoAccount.findFirst({
          where:   { organizationId: request.organizationId, isActive: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      let avitoChats = null;
      let apiError   = null;
      if (acc) {
        try {
          const { client } = await createClientForAccount(acc);
          const raw    = await client.getChats();
          avitoChats   = raw.chats ?? raw;
        } catch (err) {
          apiError = err.message;
          process.stderr.write(`[avito:dialogs] Avito API error: ${err.message}\n`);
        }
      }

      return {
        db: {
          count: dbConvs.length,
          conversations: dbConvs.map((r) => ({
            id:             r.id,
            agentId:        r.agentId,
            chatId:         r.externalId,
            externalUserId: r.externalUserId,
            messageCount:   Array.isArray(r.messages) ? r.messages.length : 0,
            updatedAt:      r.updatedAt,
          })),
        },
        avito:    avitoChats ? { count: Array.isArray(avitoChats) ? avitoChats.length : null, chats: avitoChats } : null,
        apiError: apiError ?? (acc ? null : "Нет активного аккаунта"),
      };
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // ── POST /avito/test-send ─────────────────────────────────────────────────
  // Send a test message to a specific chatId via Avito API.
  fastify.post("/avito/test-send", { preHandler: [authMiddleware] }, async (request, reply) => {
    const body   = request.body && typeof request.body === "object" ? request.body : {};
    const chatId = String(body.chatId ?? "").trim();
    const text   = String(body.text ?? "Тест: сообщение от AI платформы ✅").trim();

    if (!chatId) return reply.code(400).send({ error: "chatId is required" });

    try {
      const acc = await prisma.avitoAccount.findFirst({
        where:   { organizationId: request.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!acc) return reply.code(400).send({ error: "Нет активных Avito аккаунтов" });

      const { client } = await createClientForAccount(acc);
      const result = await client.sendMessage(chatId, text);

      process.stdout.write(`[avito:test-send] chatId=${chatId} ok\n`);
      appendAvitoLog({ type: "test-send", chatId, text, result });

      return { ok: true, chatId, text, result };
    } catch (err) {
      process.stderr.write(`[avito:test-send] error: ${err.message}\n`);
      appendAvitoLog({ type: "test-send", ok: false, chatId, error: err.message });
      return reply.code(502).send({ error: err.message });
    }
  });

  // ── GET /avito/token-check ────────────────────────────────────────────────
  // Validate the stored Avito token by making a real API call.
  fastify.get("/avito/token-check", { preHandler: [authMiddleware] }, async (request, reply) => {
    try {
      const acc = await prisma.avitoAccount.findFirst({
        where:   { organizationId: request.organizationId, isActive: true },
        orderBy: { createdAt: "asc" },
      });

      if (!acc) {
        return { ok: false, status: "no_account", message: "Нет активных аккаунтов — добавьте аккаунт" };
      }
      const { client, accountId } = await createClientForAccount(acc);
      const data       = await client.getChats();
      const chatsCount = Array.isArray(data.chats ?? data) ? (data.chats ?? data).length : null;

      process.stdout.write(`[avito:token-check] OK accountId=${accountId} chats=${chatsCount}\n`);
      appendAvitoLog({ type: "token-check", accountId, ok: true, chatsCount });

      return { ok: true, status: "valid", accountId, chatsCount, message: "Токен действителен ✅" };
    } catch (err) {
      process.stderr.write(`[avito:token-check] error: ${err.message}\n`);
      appendAvitoLog({ type: "token-check", ok: false, error: err.message });
      return { ok: false, status: "invalid", message: err.message };
    }
  });
};
