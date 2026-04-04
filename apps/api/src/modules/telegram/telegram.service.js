"use strict";

/**
 * Telegram integration: HTTP calls to Telegram API, DB, agent chat (agentRuntimeV2), image queue.
 */

const { v4: uuidv4 } = require("uuid");
const prisma = require("../../lib/prisma");
const { agentChatV2, createConversation } = require("../../services/agentRuntimeV2");
const { enhancePrompt, DEFAULT_NEGATIVE } = require("../../services/promptEnhancer");
const { analyzePrompt } = require("../../services/aiBrainV2");
const { QueueEvents } = require("bullmq");
const { getImageQueue } = require("../../queues/imageQueue");
const { getWorkerConnection } = require("../../lib/redis");

const TG_API = "https://api.telegram.org";
const WEBHOOK_BASE =
  (process.env.TELEGRAM_WEBHOOK_BASE || "https://site-al.ru/api").replace(/\/$/, "");

const KB_ROW_PHOTO = "🎨 Генерация фото";
const KB_ROW_CHAT = "🧠 Чат";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(id) {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

async function tgRequest(method, token, path, body = null) {
  const url = `${TG_API}/bot${token}${path}`;
  const opts = { method, signal: AbortSignal.timeout(30_000) };
  if (body != null) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const desc = data.description || res.statusText || "telegram_error";
    const err = new Error(typeof desc === "string" ? desc : JSON.stringify(desc));
    err.telegram = data;
    throw err;
  }
  return data;
}

async function telegramGetMe(token) {
  const data = await tgRequest("GET", token, "/getMe", null);
  return data.result;
}

async function telegramSetWebhook(token, webhookUrl) {
  return tgRequest("POST", token, "/setWebhook", { url: webhookUrl });
}

async function telegramSendMessage(token, chatId, text, extra = {}) {
  return tgRequest("POST", token, "/sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: extra.parseMode || undefined,
    reply_markup: extra.replyMarkup || undefined,
  });
}

async function telegramSendPhoto(token, chatId, photoUrl, caption) {
  return tgRequest("POST", token, "/sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption || undefined,
  });
}

async function resolveDefaultAgentId(organizationId) {
  const a = await prisma.agent.findFirst({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, rules: true, model: true },
  });
  return a;
}

async function loadAgent(agentId, organizationId) {
  return prisma.agent.findFirst({
    where: { id: agentId, organizationId, deletedAt: null },
    select: { id: true, name: true, rules: true, model: true },
  });
}

/**
 * Connect bot for authenticated SaaS user (one bot per user).
 */
async function connectBot({ userId, organizationId, botToken }) {
  const token = typeof botToken === "string" ? botToken.trim() : "";
  if (!token || token.length < 20) {
    const e = new Error("Invalid botToken");
    e.statusCode = 400;
    throw e;
  }

  const existing = await prisma.telegramBot.findUnique({ where: { userId } });
  if (existing) {
    const e = new Error("Telegram bot already connected for this account");
    e.statusCode = 409;
    throw e;
  }

  let me;
  try {
    me = await telegramGetMe(token);
  } catch (err) {
    const e = new Error(`Telegram getMe failed: ${err.message}`);
    e.statusCode = 502;
    throw e;
  }

  const botUsername = me.username ? String(me.username) : null;

  const bot = await prisma.telegramBot.create({
    data: {
      userId,
      organizationId,
      botToken: token,
      botUsername,
    },
  });

  const webhookUrl = `${WEBHOOK_BASE}/telegram/webhook/${bot.id}`;
  try {
    await telegramSetWebhook(token, webhookUrl);
  } catch (err) {
    await prisma.telegramBot.delete({ where: { id: bot.id } }).catch(() => {});
    const e = new Error(`setWebhook failed: ${err.message}`);
    e.statusCode = 502;
    throw e;
  }

  await prisma.telegramBot.update({
    where: { id: bot.id },
    data: { webhookUrl },
  });

  return {
    id: bot.id,
    botUsername,
    webhookUrl,
  };
}

/**
 * Image routing: подстроки «фото» / «сгенерируй» → отдельный pipeline (без agentChatV2).
 * Строки клавиатуры не считаем запросом картинки (иначе «Генерация фото» содержит «фото»).
 */
function isImageIntent(text) {
  const t = String(text || "").trim();
  if (t === KB_ROW_PHOTO || t === KB_ROW_CHAT) return false;
  const lower = t.toLowerCase();
  return lower.includes("фото") || lower.includes("сгенерируй");
}

/**
 * enhancePrompt + BullMQ image-generation, ожидание через waitUntilFinished (QueueEvents).
 * Не вызывает agentChatV2.
 */
async function runImagePipeline({ bot, rawPrompt }) {
  const queue = getImageQueue();
  const jobId = uuidv4();
  const trimmed = rawPrompt.trim();
  const brain = analyzePrompt(trimmed);
  const enh = await enhancePrompt(trimmed, { brain });
  const improvedPrompt = enh.enhancedPrompt || trimmed;
  const negativePrompt = enh.negativePrompt || DEFAULT_NEGATIVE;

  const job = await queue.add(
    "generate",
    {
      prompt: improvedPrompt,
      negativePrompt,
      originalPrompt: trimmed,
      width: 1024,
      height: 1024,
      userId: bot.userId,
      organizationId: bot.organizationId,
      jobId,
      mode: "text",
      variations: 1,
      seed: Math.floor(Math.random() * 999999),
    },
    { jobId }
  );

  const connection = getWorkerConnection();
  const queueEvents = new QueueEvents("image-generation", { connection });
  let result;
  try {
    result = await job.waitUntilFinished(queueEvents, 180_000);
  } finally {
    await queueEvents.close();
  }

  const url = result?.url || (Array.isArray(result?.urls) && result.urls[0]);
  if (!url) throw new Error("No image URL in job result");
  return {
    url,
    prompt: improvedPrompt,
    jobId,
    result,
  };
}

async function ensureTelegramUser(from) {
  const telegramId = String(from.id);
  let row = await prisma.telegramUser.findUnique({ where: { telegramId } });
  if (row) {
    row = await prisma.telegramUser.update({
      where: { telegramId },
      data: {
        username: from.username != null ? String(from.username) : null,
        firstName: from.first_name != null ? String(from.first_name) : null,
        lastName: from.last_name != null ? String(from.last_name) : null,
      },
    });
    return row;
  }
  return prisma.telegramUser.create({
    data: {
      telegramId,
      username: from.username != null ? String(from.username) : null,
      firstName: from.first_name != null ? String(from.first_name) : null,
      lastName: from.last_name != null ? String(from.last_name) : null,
    },
  });
}

async function getOrCreateTelegramChat(bot, telegramChatIdStr) {
  let chat = await prisma.telegramChat.findUnique({
    where: { botId_telegramChatId: { botId: bot.id, telegramChatId: telegramChatIdStr } },
  });
  if (chat) return chat;

  const defaultAgent = await resolveDefaultAgentId(bot.organizationId);
  if (!defaultAgent) {
    const e = new Error("No agent in organization; create an agent first");
    e.statusCode = 503;
    throw e;
  }

  return prisma.telegramChat.create({
    data: {
      botId: bot.id,
      telegramChatId: telegramChatIdStr,
      userId: bot.userId,
      agentId: defaultAgent.id,
    },
  });
}

async function runAgentChatForTelegram(bot, tgChat, text) {
  const agentId = tgChat.agentId;
  if (!agentId) {
    const e = new Error("Chat has no agent");
    e.statusCode = 503;
    throw e;
  }

  const agent = await loadAgent(agentId, bot.organizationId);
  if (!agent) {
    const e = new Error("Agent not found");
    e.statusCode = 404;
    throw e;
  }

  let conversationId = tgChat.conversationId;
  if (!conversationId) {
    const conv = await createConversation(agentId, bot.userId, bot.organizationId, null);
    conversationId = conv.id;
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: { conversationId },
    });
  }

  const result = await agentChatV2({
    conversationId,
    message: text,
    organizationId: bot.organizationId,
    systemPrompt: agent.rules?.trim() || null,
    model: agent.model || undefined,
  });

  await prisma.telegramChat.update({
    where: { id: tgChat.id },
    data: { conversationId: result.conversationId },
  });

  return result.reply;
}

/**
 * Process one Telegram update for a verified bot row.
 */
async function processTelegramUpdate(bot, update) {
  const token = bot.botToken;
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return { ok: true, skipped: true };

  const chatId = msg.chat.id;
  const chatIdStr = String(chatId);

  const text = msg.text != null ? String(msg.text) : "";
  if (msg.from) await ensureTelegramUser(msg.from);

  if (text.startsWith("/start")) {
    await telegramSendMessage(token, chatId, "Привет! Я подключён к вашему AI-кабинету. Выберите режим кнопками или пишите сообщения.", {
      replyMarkup: {
        keyboard: [[{ text: KB_ROW_PHOTO }], [{ text: KB_ROW_CHAT }]],
        resize_keyboard: true,
      },
    });
    return { ok: true };
  }

  if (text === KB_ROW_PHOTO) {
    await telegramSendMessage(
      token,
      chatId,
      "Режим генерации: опишите картинку в сообщении (можно со словами «фото» или «сгенерируй»)."
    );
    return { ok: true };
  }
  if (text === KB_ROW_CHAT) {
    await telegramSendMessage(token, chatId, "Режим чата: пишите вопросы — ответит ваш агент с памятью диалога.");
    return { ok: true };
  }

  if (!text.trim()) {
    return { ok: true, skipped: true };
  }

  if (isImageIntent(text)) {
    await telegramSendMessage(token, chatId, "⏳ Генерирую изображение...");
    try {
      const out = await runImagePipeline({ bot, rawPrompt: text });
      console.log("[TELEGRAM IMAGE FLOW] prompt:", out.prompt);
      console.log("[TELEGRAM IMAGE FLOW] jobId:", out.jobId);
      console.log("[TELEGRAM IMAGE FLOW] result:", JSON.stringify({ url: out.url, hasUrls: Boolean(out.result?.urls) }));
      await telegramSendPhoto(token, chatId, out.url, String(out.prompt).slice(0, 900));
    } catch (err) {
      process.stderr.write(`[telegram] image pipeline: ${err.message}\n`);
      console.log("[TELEGRAM IMAGE FLOW] error:", err.message);
      await telegramSendMessage(token, chatId, "❌ Ошибка генерации");
    }
    return { ok: true };
  }

  const tgChat = await getOrCreateTelegramChat(bot, chatIdStr);

  try {
    const replyText = await runAgentChatForTelegram(bot, tgChat, text);
    await telegramSendMessage(token, chatId, replyText || "…");
  } catch (err) {
    process.stderr.write(`[telegram] chat: ${err.message}\n`);
    await telegramSendMessage(token, chatId, `Ошибка чата: ${err.message}`);
  }

  return { ok: true };
}

module.exports = {
  isValidUuid,
  connectBot,
  processTelegramUpdate,
  telegramSendMessage,
  KB_ROW_PHOTO,
  KB_ROW_CHAT,
};
