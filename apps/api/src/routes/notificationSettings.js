"use strict";

/**
 * notificationSettings.js — per-organization notification settings API.
 *
 * All endpoints require JWT auth via middleware/auth (sets request.organizationId).
 * OWNER/ADMIN can change; MEMBER/VIEWER can only read.
 *
 * Endpoints:
 *   GET    /notification-settings                 — current effective settings + source
 *   PUT    /notification-settings                  — upsert settings
 *   POST   /notification-settings/test             — send a test message to Telegram
 */

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const {
  resolveManagerChannel,
  sendTestMessage,
} = require("../services/notifyManager");

const WRITE_ROLES = new Set(["OWNER", "ADMIN"]);

/**
 * Return the effective caller role for the requested org (from membership).
 * @param {string} userId
 * @param {string} organizationId
 */
async function getUserRole(userId, organizationId) {
  const m = await prisma.membership.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { role: true },
  });
  return m ? String(m.role).toUpperCase() : null;
}

/** @param {unknown} v */
function asTrimmedString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** @param {unknown} v @param {boolean} fallback */
function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

/**
 * @param {{
 *   id: string,
 *   tgManagerBotToken: string | null,
 *   tgManagerChatId: string | null,
 *   tgManagerEnabled: boolean,
 *   notifyOnNewLead: boolean,
 *   notifyOnHandoff: boolean,
 *   notifyOnHotLead: boolean,
 *   emailEnabled: boolean,
 *   emailRecipients: string | null,
 *   updatedAt: Date,
 * } | null} row
 */
function serializeSettings(row) {
  if (!row) {
    return {
      tgManagerBotTokenSet: false,
      tgManagerChatId: "",
      tgManagerEnabled: true,
      notifyOnNewLead: true,
      notifyOnHandoff: true,
      notifyOnHotLead: true,
      emailEnabled: false,
      emailRecipients: "",
      updatedAt: null,
    };
  }
  return {
    // Never expose the raw token — only a boolean flag ("is it set?")
    tgManagerBotTokenSet: Boolean(row.tgManagerBotToken && row.tgManagerBotToken.trim()),
    tgManagerChatId:      row.tgManagerChatId || "",
    tgManagerEnabled:     row.tgManagerEnabled,
    notifyOnNewLead:      row.notifyOnNewLead,
    notifyOnHandoff:      row.notifyOnHandoff,
    notifyOnHotLead:      row.notifyOnHotLead,
    emailEnabled:         row.emailEnabled,
    emailRecipients:      row.emailRecipients || "",
    updatedAt:            row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function notificationSettingsRoutes(fastify) {
  // ── GET /notification-settings ────────────────────────────────────────────
  fastify.get(
    "/notification-settings",
    { preHandler: authMiddleware },
    async (request) => {
      const organizationId = String(request.organizationId);
      const row = await prisma.organizationNotificationSettings.findUnique({
        where: { organizationId },
      });
      const channel = await resolveManagerChannel(organizationId);
      return {
        settings: serializeSettings(row),
        effective: {
          // Whether a manager alert can actually be sent right now (DB OR env).
          telegramReady: Boolean(channel.botToken && channel.chatId && channel.enabled),
          source:        channel.source, // "db" | "env" | "none"
        },
      };
    }
  );

  // ── PUT /notification-settings ────────────────────────────────────────────
  fastify.put(
    "/notification-settings",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const organizationId = String(request.organizationId);
      const role = await getUserRole(request.userId, organizationId);
      if (!role || !WRITE_ROLES.has(role)) {
        return reply.code(403).send({ error: "forbidden: OWNER or ADMIN required" });
      }

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const existing = await prisma.organizationNotificationSettings.findUnique({
        where: { organizationId },
      });

      // Bot token: only overwrite when the client explicitly sends a non-empty
      // string. Sending `null` clears the token. Sending `undefined` keeps as-is.
      let tgManagerBotToken = existing ? existing.tgManagerBotToken : null;
      if ("tgManagerBotToken" in body) {
        const raw = body.tgManagerBotToken;
        if (raw === null) {
          tgManagerBotToken = null;
        } else if (typeof raw === "string" && raw.trim() !== "") {
          tgManagerBotToken = raw.trim();
        }
        // empty string is treated as "no change" (UI uses placeholder)
      }

      const data = {
        tgManagerBotToken,
        tgManagerChatId:  "tgManagerChatId" in body ? asTrimmedString(body.tgManagerChatId) : (existing?.tgManagerChatId ?? null),
        tgManagerEnabled: asBool(body.tgManagerEnabled,  existing?.tgManagerEnabled  ?? true),
        notifyOnNewLead:  asBool(body.notifyOnNewLead,   existing?.notifyOnNewLead   ?? true),
        notifyOnHandoff:  asBool(body.notifyOnHandoff,   existing?.notifyOnHandoff   ?? true),
        notifyOnHotLead:  asBool(body.notifyOnHotLead,   existing?.notifyOnHotLead   ?? true),
        emailEnabled:     asBool(body.emailEnabled,      existing?.emailEnabled      ?? false),
        emailRecipients:  "emailRecipients" in body ? asTrimmedString(body.emailRecipients) : (existing?.emailRecipients ?? null),
      };

      const row = await prisma.organizationNotificationSettings.upsert({
        where:  { organizationId },
        update: data,
        create: { organizationId, ...data },
      });

      const channel = await resolveManagerChannel(organizationId);
      return {
        settings: serializeSettings(row),
        effective: {
          telegramReady: Boolean(channel.botToken && channel.chatId && channel.enabled),
          source:        channel.source,
        },
      };
    }
  );

  // ── POST /notification-settings/test ──────────────────────────────────────
  fastify.post(
    "/notification-settings/test",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const organizationId = String(request.organizationId);
      const role = await getUserRole(request.userId, organizationId);
      if (!role || !WRITE_ROLES.has(role)) {
        return reply.code(403).send({ error: "forbidden: OWNER or ADMIN required" });
      }

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const customText = typeof body.text === "string" ? body.text : undefined;

      const result = await sendTestMessage(organizationId, customText);
      if (!result.ok) {
        return reply.code(400).send({
          ok: false,
          error:  result.error || "Не удалось отправить сообщение",
          source: result.source,
        });
      }
      return { ok: true, source: result.source };
    }
  );
};
