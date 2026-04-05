"use strict";

const prisma = require("../../lib/prisma");
const { connectBot, processTelegramUpdate, isValidUuid } = require("./telegram.service");

/**
 * POST /telegram/connect — JWT; body: { botToken }
 */
async function postConnect(request, reply) {
  const body = typeof request.body === "object" && request.body ? request.body : {};
  const botToken = body.botToken;

  try {
    const out = await connectBot({
      userId: request.userId,
      organizationId: request.organizationId,
      botToken,
    });
    return reply.code(200).send({
      ok: true,
      botId: out.id,
      botUsername: out.botUsername,
      webhookUrl: out.webhookUrl,
    });
  } catch (err) {
    const code = err.statusCode && Number(err.statusCode) >= 400 ? err.statusCode : 500;
    return reply.code(code).send({ error: err.message || "connect_failed" });
  }
}

/**
 * POST /telegram/webhook/:botId — public (Telegram servers)
 */
async function postWebhook(request, reply) {
  const rawId = request.params && request.params.botId ? String(request.params.botId).trim() : "";
  if (!isValidUuid(rawId)) {
    return reply.code(404).send({ error: "not found" });
  }

  const bot = await prisma.telegramBot.findFirst({
    where: { id: rawId, isActive: true },
  });
  if (!bot) {
    return reply.code(404).send({ error: "not found" });
  }

  const secretHdr = request.headers["x-telegram-bot-api-secret-token"];
  const secretStr = typeof secretHdr === "string" ? secretHdr : "";
  if (bot.webhookSecretToken) {
    if (secretStr !== bot.webhookSecretToken) {
      request.log.warn({ botId: bot.id }, "[telegram] webhook X-Telegram-Bot-Api-Secret-Token mismatch RAW");
      return reply.code(403).send({ error: "forbidden" });
    }
  }

  try {
    await processTelegramUpdate(bot, request.body || {});
  } catch (err) {
    request.log.error({ err }, "[telegram] webhook handler");
  }

  return reply.code(200).send({ ok: true });
}

module.exports = {
  postConnect,
  postWebhook,
};
