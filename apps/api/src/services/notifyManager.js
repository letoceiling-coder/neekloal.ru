"use strict";

/**
 * notifyManager.js — per-organization Telegram alerts for managers.
 *
 * Settings are read from the DB (OrganizationNotificationSettings).
 * If the DB row is absent or fields are empty, we fall back to env variables
 * (LEAD_NOTIFY_TELEGRAM_BOT_TOKEN / LEAD_NOTIFY_TELEGRAM_CHAT_ID) so that
 * existing deployments keep working without manual reconfiguration.
 *
 * Public API:
 *   resolveManagerChannel(organizationId)       — effective {botToken, chatId, source}
 *   sendManagerText(organizationId, text)       — raw text (Telegram plain, ≤4000 chars)
 *   sendHandoffAlert(params)                    — formatted HANDOFF brief
 *   sendNewLeadAlert(params)                    — formatted new-lead brief (generic)
 *   sendTestMessage(organizationId)             — manual test from admin UI
 *
 * Rate limiting: reuses existing leadNotificationRate (org-per-hour + leadId dedup).
 */

const prisma = require("../lib/prisma");
const { tryAcquireLeadNotify } = require("./leadNotificationRate");

// ── HTTP helpers ─────────────────────────────────────────────────────────────

const TG_MAX_CHARS = 4000;

/**
 * POST Telegram sendMessage (plain text, silent errors logged by caller).
 * @param {string} botToken
 * @param {string} chatId
 * @param {string} text
 */
async function telegramSend(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: String(text).slice(0, TG_MAX_CHARS),
    disable_web_page_preview: true,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err = new Error(`Telegram ${res.status}: ${txt.slice(0, 400)}`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
}

// ── Settings loader ──────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   botToken: string | null,
 *   chatId:   string | null,
 *   enabled:  boolean,
 *   notifyOnNewLead: boolean,
 *   notifyOnHandoff: boolean,
 *   notifyOnHotLead: boolean,
 *   source:   "db" | "env" | "none",
 * }} ManagerChannel
 */

/**
 * Read the effective Telegram manager channel for an organization.
 * DB values take precedence; empty strings fall back to env.
 *
 * @param {string} organizationId
 * @returns {Promise<ManagerChannel>}
 */
async function resolveManagerChannel(organizationId) {
  const row = organizationId
    ? await prisma.organizationNotificationSettings.findUnique({
        where: { organizationId: String(organizationId) },
      })
    : null;

  const dbToken   = row && row.tgManagerBotToken && String(row.tgManagerBotToken).trim() || "";
  const dbChatId  = row && row.tgManagerChatId   && String(row.tgManagerChatId).trim()   || "";
  const dbEnabled = row ? Boolean(row.tgManagerEnabled) : true;

  const envToken  = process.env.LEAD_NOTIFY_TELEGRAM_BOT_TOKEN || "";
  const envChatId = process.env.LEAD_NOTIFY_TELEGRAM_CHAT_ID   || "";

  const botToken = dbToken || envToken || "";
  const chatId   = dbChatId || envChatId || "";
  const source   = dbToken && dbChatId ? "db" : (envToken && envChatId ? "env" : "none");

  return {
    botToken: botToken || null,
    chatId:   chatId   || null,
    enabled:  dbEnabled,
    notifyOnNewLead: row ? Boolean(row.notifyOnNewLead) : true,
    notifyOnHandoff: row ? Boolean(row.notifyOnHandoff) : true,
    notifyOnHotLead: row ? Boolean(row.notifyOnHotLead) : true,
    source,
  };
}

/**
 * Send a raw plain-text message via the organization's manager Telegram channel.
 * Returns `{ ok: true }` on success, or `{ ok: false, reason }` if the channel
 * is not configured / disabled.
 *
 * @param {string} organizationId
 * @param {string} text
 * @returns {Promise<{ ok: boolean, reason?: string, source?: string }>}
 */
async function sendManagerText(organizationId, text) {
  const ch = await resolveManagerChannel(organizationId);
  if (!ch.enabled) {
    return { ok: false, reason: "channel_disabled", source: ch.source };
  }
  if (!ch.botToken || !ch.chatId) {
    return { ok: false, reason: "channel_not_configured", source: ch.source };
  }
  await telegramSend(ch.botToken, ch.chatId, text);
  return { ok: true, source: ch.source };
}

// ── Conversation summary helper ──────────────────────────────────────────────

/**
 * Build a short textual summary from the last N messages of an AgentConversation.
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} [max=5]
 * @returns {string}
 */
function summarizeMessages(messages, max) {
  const n = typeof max === "number" && max > 0 ? max : 5;
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const tail = messages.slice(-n);
  return tail
    .map((m) => {
      const who = m.role === "assistant" ? "AI" : m.role === "user" ? "Клиент" : m.role;
      const txt = String(m.content || "").replace(/\s+/g, " ").trim();
      return `${who}: ${txt.slice(0, 240)}`;
    })
    .join("\n");
}

// ── Public formatters ────────────────────────────────────────────────────────

/**
 * Send a HANDOFF alert (phone detected, contact request, hot lead, stuck).
 *
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} p.leadId
 * @param {string} [p.source]         — "avito" | "telegram" | "site" | …
 * @param {string} [p.authorName]
 * @param {string} [p.chatId]
 * @param {string} [p.externalUserId]
 * @param {string} [p.phone]
 * @param {string} [p.intent]
 * @param {string} [p.status]         — FSM status (NEW/QUALIFYING/…)
 * @param {boolean}[p.isHot]
 * @param {string} [p.chatUrl]        — link to CRM chat page (site-al.ru/avito?chatId=…)
 * @param {Array<{role:string,content:string}>} [p.messages]
 * @returns {Promise<{ ok: boolean, skipped?: string }>}
 */
async function sendHandoffAlert(p) {
  const ch = await resolveManagerChannel(p.organizationId);
  if (!ch.enabled)                   return { ok: false, skipped: "disabled" };
  if (!ch.notifyOnHandoff)           return { ok: false, skipped: "handoff_disabled" };
  if (!ch.botToken || !ch.chatId)    return { ok: false, skipped: "not_configured" };
  if (!tryAcquireLeadNotify(p.organizationId, `handoff:${p.leadId}`)) {
    return { ok: false, skipped: "rate_limited" };
  }

  const tag = p.isHot ? "🔥 Горячий лид" : "🤝 Новый HANDOFF";
  const src = p.source ? p.source.toUpperCase() : "CHAT";
  const summary = summarizeMessages(p.messages);

  const lines = [
    `${tag} (${src})`,
    p.authorName ? `Клиент: ${p.authorName}` : null,
    p.phone ? `Телефон: ${p.phone}` : null,
    p.intent ? `Интент: ${p.intent}` : null,
    p.status ? `Статус воронки: ${p.status}` : null,
    p.chatId ? `Chat ID: ${p.chatId}` : null,
    summary ? `\nПоследние сообщения:\n${summary}` : null,
    p.chatUrl ? `\nОткрыть: ${p.chatUrl}` : null,
  ].filter(Boolean);

  try {
    await telegramSend(ch.botToken, ch.chatId, lines.join("\n"));
    return { ok: true };
  } catch (err) {
    process.stderr.write(
      `[notifyManager] handoff alert failed org=${p.organizationId}: ${err && err.message ? err.message : String(err)}\n`
    );
    return { ok: false, skipped: "send_failed" };
  }
}

/**
 * Send a generic new-lead alert (first contact across any channel).
 *
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} p.leadId
 * @param {string} [p.source]
 * @param {string} [p.name]
 * @param {string} [p.phone]
 * @param {string} [p.firstMessage]
 * @param {string} [p.chatUrl]
 * @returns {Promise<{ ok: boolean, skipped?: string }>}
 */
async function sendNewLeadAlert(p) {
  const ch = await resolveManagerChannel(p.organizationId);
  if (!ch.enabled)                 return { ok: false, skipped: "disabled" };
  if (!ch.notifyOnNewLead)         return { ok: false, skipped: "newlead_disabled" };
  if (!ch.botToken || !ch.chatId)  return { ok: false, skipped: "not_configured" };
  if (!tryAcquireLeadNotify(p.organizationId, `newlead:${p.leadId}`)) {
    return { ok: false, skipped: "rate_limited" };
  }

  const src = p.source ? p.source.toUpperCase() : "CHAT";
  const lines = [
    `🆕 Новый лид (${src})`,
    p.name  ? `Имя: ${p.name}`                                    : null,
    p.phone ? `Телефон: ${p.phone}`                               : null,
    p.firstMessage
      ? `Сообщение: ${String(p.firstMessage).slice(0, 500)}`
      : null,
    p.chatUrl ? `\nОткрыть: ${p.chatUrl}` : null,
  ].filter(Boolean);

  try {
    await telegramSend(ch.botToken, ch.chatId, lines.join("\n"));
    return { ok: true };
  } catch (err) {
    process.stderr.write(
      `[notifyManager] new-lead alert failed org=${p.organizationId}: ${err && err.message ? err.message : String(err)}\n`
    );
    return { ok: false, skipped: "send_failed" };
  }
}

/**
 * Send a manual test message — used by the admin UI to verify credentials.
 *
 * @param {string} organizationId
 * @param {string} [customText]
 * @returns {Promise<{ ok: boolean, error?: string, source: string }>}
 */
async function sendTestMessage(organizationId, customText) {
  const ch = await resolveManagerChannel(organizationId);
  if (!ch.botToken || !ch.chatId) {
    return { ok: false, error: "Не настроен Telegram: укажите Bot Token и Chat ID", source: ch.source };
  }
  const text = customText && String(customText).trim()
    ? String(customText).trim()
    : "✅ Тестовое уведомление от neeklo.studio. Канал настроен корректно.";
  try {
    await telegramSend(ch.botToken, ch.chatId, text);
    return { ok: true, source: ch.source };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      source: ch.source,
    };
  }
}

module.exports = {
  resolveManagerChannel,
  sendManagerText,
  sendHandoffAlert,
  sendNewLeadAlert,
  sendTestMessage,
  summarizeMessages,
};
