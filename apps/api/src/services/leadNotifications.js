"use strict";

const { tryAcquireLeadNotify } = require("./leadNotificationRate");
const { resolveManagerChannel, sendManagerText } = require("./notifyManager");

/**
 * Уведомления о новых лидах (Telegram + email через SMTP).
 *
 * Telegram-настройки берутся из OrganizationNotificationSettings (БД).
 * Если в БД пусто — fallback на LEAD_NOTIFY_TELEGRAM_BOT_TOKEN / _CHAT_ID
 * (для обратной совместимости старых инсталляций).
 *
 * Лимит частоты: см. leadNotificationRate.js
 *
 * Env (только для email/SMTP и как fallback для TG):
 *   LEAD_NOTIFY_TELEGRAM_BOT_TOKEN, LEAD_NOTIFY_TELEGRAM_CHAT_ID  (fallback)
 *   LEAD_NOTIFY_EMAIL_TO (через запятую), LEAD_NOTIFY_EMAIL_FROM
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 */

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} subject
 * @param {string} html
 */
async function sendLeadEmail(subject, html) {
  const to = process.env.LEAD_NOTIFY_EMAIL_TO;
  const from = process.env.LEAD_NOTIFY_EMAIL_FROM || process.env.SMTP_FROM;
  const host = process.env.SMTP_HOST;
  if (!to || !from || !host) {
    return;
  }
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure:
      String(process.env.SMTP_SECURE || "") === "1" ||
      String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER != null && String(process.env.SMTP_USER).trim() !== ""
        ? {
            user: String(process.env.SMTP_USER).trim(),
            pass: String(process.env.SMTP_PASS || ""),
          }
        : undefined,
  });
  const recipients = String(to)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await transporter.sendMail({
    from,
    to: recipients.join(", "),
    subject: subject.slice(0, 200),
    text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    html,
  });
}

/**
 * @param {object} p
 * @param {import('@prisma/client').Lead} p.lead
 * @param {string|null|undefined} p.organizationName
 * @param {{ info?: (o: object, m?: string) => void }} [log]
 */
async function notifyNewLead(p, log) {
  const { lead, organizationName } = p;
  if (!tryAcquireLeadNotify(lead.organizationId, lead.id)) {
    log?.info?.({ leadId: lead.id }, "lead notify skipped (rate limit)");
    return;
  }
  const org = organizationName != null ? String(organizationName) : "—";
  const lines = [
    "Новый лид",
    `Организация: ${org}`,
    lead.name ? `Имя: ${lead.name}` : null,
    lead.phone ? `Телефон: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    `Источник: ${lead.source}`,
    lead.firstMessage ? `Сообщение: ${String(lead.firstMessage).slice(0, 500)}` : null,
  ].filter(Boolean);
  const plain = lines.join("\n");

  const htmlParts = [
    "<p><strong>Новый лид</strong></p>",
    `<p>Организация: ${escapeHtml(org)}</p>`,
    lead.name ? `<p>Имя: ${escapeHtml(lead.name)}</p>` : "",
    lead.phone ? `<p>Телефон: ${escapeHtml(String(lead.phone))}</p>` : "",
    lead.email ? `<p>Email: ${escapeHtml(String(lead.email))}</p>` : "",
    `<p>Источник: ${escapeHtml(String(lead.source))}</p>`,
    lead.firstMessage
      ? `<p>Сообщение: ${escapeHtml(String(lead.firstMessage).slice(0, 2000))}</p>`
      : "",
  ];
  const html = htmlParts.join("");

  const tasks = [];

  // Telegram — per-org DB settings, env as fallback, controlled by notifyOnNewLead flag.
  const managerCh = await resolveManagerChannel(lead.organizationId);
  if (managerCh.enabled && managerCh.notifyOnNewLead && managerCh.botToken && managerCh.chatId) {
    tasks.push(
      sendManagerText(lead.organizationId, plain).then((r) => {
        if (!r.ok) {
          log?.info?.({ leadId: lead.id, reason: r.reason }, "lead telegram skipped");
        }
      })
    );
  }

  if (
    process.env.LEAD_NOTIFY_EMAIL_TO &&
    process.env.SMTP_HOST &&
    (process.env.LEAD_NOTIFY_EMAIL_FROM || process.env.SMTP_FROM)
  ) {
    tasks.push(sendLeadEmail(`Новый лид — ${org}`, html));
  }

  if (tasks.length === 0) {
    return;
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length && failed[0]) {
    throw failed[0].reason;
  }
}

module.exports = { notifyNewLead };
