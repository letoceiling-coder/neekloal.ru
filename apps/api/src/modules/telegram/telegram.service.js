"use strict";

/**
 * Telegram integration: HTTP calls to Telegram API, DB, Ollama-only chat + BullMQ image queue.
 * Text replies use direct Ollama /api/chat only (not the dashboard widget chat path).
 */

const { v4: uuidv4 } = require("uuid");
const prisma = require("../../lib/prisma");
const { createConversation } = require("../../services/agentRuntimeV2");
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

/** Inline mode switcher — прикрепляем к ответам бота. */
const MODE_INLINE_REPLY_MARKUP = {
  inline_keyboard: [
    [{ text: "🎨 Генерация", callback_data: "mode_image" }],
    [{ text: "🧠 Чат", callback_data: "mode_chat" }],
  ],
};

function modeFooterLine(mode) {
  return `Текущий режим: ${mode === "image" ? "🎨 генерация" : "🧠 чат"}`;
}

/** Единый базовый system prompt для Telegram (локально для этого модуля). */
const BASE_SYSTEM_PROMPT = `
Ты — живой человек и профессиональный помощник.

Ты не искусственный интеллект и не должен об этом говорить.

Ты общаешься как реальный человек:
— естественно
— понятно
— без лишней воды

ПРАВИЛА:
— всегда отвечай только на русском языке
— не говори что ты AI
— не используй markdown и списки без необходимости
— пиши как в обычной переписке

СТИЛЬ:
— дружелюбный
— иногда лёгкий юмор
— по делу
— можешь задавать уточняющие вопросы

ПОВЕДЕНИЕ:
— простой вопрос → короткий ответ
— сложный → объясни понятно
— если есть варианты → предложи

Главное:
будь живым и нормальным собеседником
`.trim();

function getOllamaChatUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");
  return `${base.replace(/\/$/, "")}/api/chat`;
}

function buildOllamaBody(model, messages, { temperature, maxTokens, stream = false }) {
  const body = { model, messages, stream };
  const opts = {};
  if (temperature != null) opts.temperature = temperature;
  if (maxTokens != null) opts.num_predict = maxTokens;
  if (Object.keys(opts).length) body.options = opts;
  return body;
}

/**
 * Один вызов Ollama /api/chat (только для Telegram-чата).
 */
async function ollamaTelegramOnce(model, fullMessages, temperature = 0.7, maxTokens) {
  const ollamaRes = await fetch(getOllamaChatUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildOllamaBody(model, fullMessages, { temperature, maxTokens, stream: false })),
  });
  if (!ollamaRes.ok) {
    const err = await ollamaRes.text();
    throw new Error(`Ollama /api/chat failed: ${ollamaRes.status} — ${err.slice(0, 300)}`);
  }
  const data = await ollamaRes.json();
  return data.message?.content ?? "";
}

async function translateToRussianViaOllama(text, model) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return "";
  const messages = [
    {
      role: "system",
      content:
        "Переведи на русский язык. Сохрани смысл и тон. Ответь только переведённым текстом, без пояснений и без английских вставок.",
    },
    { role: "user", content: t },
  ];
  try {
    const out = await ollamaTelegramOnce(model, messages, 0.2, 1024);
    return typeof out === "string" && out.trim() ? out.trim() : t;
  } catch {
    return t;
  }
}

async function enforceRussian(text, model) {
  const s = typeof text === "string" ? text : "";
  if (!/[A-Za-z]/.test(s)) {
    return s;
  }
  console.log("[FORCE RUSSIAN TRANSLATE]");
  return translateToRussianViaOllama(s, model);
}

function buildTelegramFinalSystemPrompt(agent) {
  const ass = agent.assistant && !agent.assistant.deletedAt ? agent.assistant : null;
  const custom = (ass?.systemPrompt?.trim() || agent.rules?.trim() || "");
  const extraBlock = custom ? `\n\nДополнительные инструкции:\n\n${custom}` : "";
  return `${BASE_SYSTEM_PROMPT}${extraBlock}`;
}

function stripEnglishTelegramArtifacts(response) {
  if (response == null || typeof response !== "string") return "";
  return response.replace(/Here is|Here's|Sure!/gi, "").trim();
}

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

async function telegramSendPhoto(token, chatId, photoUrl, caption, replyMarkup) {
  return tgRequest("POST", token, "/sendPhoto", {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption || undefined,
    reply_markup: replyMarkup || undefined,
  });
}

async function telegramAnswerCallbackQuery(token, callbackQueryId, extra = {}) {
  return tgRequest("POST", token, "/answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    show_alert: Boolean(extra.showAlert),
    text: extra.text != null ? String(extra.text) : undefined,
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
    select: {
      id: true,
      name: true,
      rules: true,
      model: true,
      assistant: {
        select: { systemPrompt: true, model: true, deletedAt: true },
      },
    },
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
 * enhancePrompt + BullMQ image-generation, ожидание через waitUntilFinished (QueueEvents).
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

async function ollamaTelegramChat(bot, tgChat, text) {
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

  const conv = await prisma.agentConversation.findFirst({
    where: { id: conversationId, organizationId: bot.organizationId },
  });
  if (!conv) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  const ass = agent.assistant && !agent.assistant.deletedAt ? agent.assistant : null;
  const model = ass?.model || agent.model || "qwen2.5:14b";
  const modelFallback = "llama3:8b";

  console.log("[MODEL USED]:", model);

  const finalPrompt = buildTelegramFinalSystemPrompt(agent);
  const systemPromptFinal = `
${finalPrompt}

ВАЖНО:
— думай на русском языке
— формируй ответ сразу на русском
— не используй английские конструкции
— если возникает английская фраза — перепиши её на русский ДО отправки

КРИТИЧНО:
не «переводи», а изначально отвечай на русском — без смешения языков.
`.trim();

  const history = Array.isArray(conv.messages) ? conv.messages : [];
  const fullMessages = [];
  if (systemPromptFinal.trim()) {
    fullMessages.push({ role: "system", content: systemPromptFinal.trim() });
  }
  fullMessages.push(...history, { role: "user", content: text });

  process.stdout.write(
    `[telegram:chat] conv=${conversationId} try_model=${model} ctx=${history.length}\n`
  );

  let usedModel = model;
  let content;
  try {
    content = await ollamaTelegramOnce(model, fullMessages, 0.7, undefined);
  } catch (e) {
    console.error("[LLM PRIMARY ERROR]", e?.message || e);
    console.log("[FALLBACK USED]");
    process.stdout.write(`[telegram:chat] switching to fallback model=${modelFallback}\n`);
    usedModel = modelFallback;
    content = await ollamaTelegramOnce(modelFallback, fullMessages, 0.7, undefined);
  }

  let reply = stripEnglishTelegramArtifacts(typeof content === "string" ? content : "");
  reply = await enforceRussian(reply, usedModel);

  const updatedMessages = [...history, { role: "user", content: text }, { role: "assistant", content: reply }];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data: { messages: updatedMessages },
  });

  await prisma.telegramChat.update({
    where: { id: tgChat.id },
    data: { conversationId },
  });

  return reply;
}

/**
 * Process one Telegram update for a verified bot row.
 */
async function processTelegramUpdate(bot, update) {
  const token = bot.botToken;

  if (update.callback_query) {
    const cq = update.callback_query;
    const msg = cq.message;
    if (!msg || !msg.chat) return { ok: true, skipped: true };
    const chatId = msg.chat.id;
    const chatIdStr = String(chatId);
    if (cq.from) await ensureTelegramUser(cq.from);

    const tgChat = await getOrCreateTelegramChat(bot, chatIdStr);
    const data = String(cq.data || "");

    if (data === "mode_chat") {
      await prisma.telegramChat.update({ where: { id: tgChat.id }, data: { mode: "chat" } });
      await telegramAnswerCallbackQuery(token, cq.id);
      console.log("[TELEGRAM MODE]: chat");
      console.log("[TELEGRAM FLOW]: chat");
      await telegramSendMessage(token, chatId, `🧠 Режим чата включен\n\n${modeFooterLine("chat")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      return { ok: true };
    }
    if (data === "mode_image") {
      await prisma.telegramChat.update({ where: { id: tgChat.id }, data: { mode: "image" } });
      await telegramAnswerCallbackQuery(token, cq.id);
      console.log("[TELEGRAM MODE]: image");
      console.log("[TELEGRAM FLOW]: image");
      await telegramSendMessage(token, chatId, `🎨 Режим генерации включен\n\n${modeFooterLine("image")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      return { ok: true };
    }

    await telegramAnswerCallbackQuery(token, cq.id);
    return { ok: true };
  }

  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return { ok: true, skipped: true };

  const chatId = msg.chat.id;
  const chatIdStr = String(chatId);

  const text = msg.text != null ? String(msg.text) : "";
  if (msg.from) await ensureTelegramUser(msg.from);

  if (text.startsWith("/start")) {
    await telegramSendMessage(token, chatId, `Привет! Выберите режим кнопками ниже — затем пишите сообщения.\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    return { ok: true };
  }

  const tgChat = await getOrCreateTelegramChat(bot, chatIdStr);

  if (text === KB_ROW_PHOTO) {
    await prisma.telegramChat.update({ where: { id: tgChat.id }, data: { mode: "image" } });
    console.log("[TELEGRAM MODE]: image");
    console.log("[TELEGRAM FLOW]: image");
    await telegramSendMessage(token, chatId, `🎨 Режим генерации включен\n\n${modeFooterLine("image")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    return { ok: true };
  }
  if (text === KB_ROW_CHAT) {
    await prisma.telegramChat.update({ where: { id: tgChat.id }, data: { mode: "chat" } });
    console.log("[TELEGRAM MODE]: chat");
    console.log("[TELEGRAM FLOW]: chat");
    await telegramSendMessage(token, chatId, `🧠 Режим чата включен\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    return { ok: true };
  }

  if (!text.trim()) {
    return { ok: true, skipped: true };
  }

  const latest = await prisma.telegramChat.findUnique({ where: { id: tgChat.id } });
  const mode = (latest && latest.mode) || "chat";

  console.log("[TELEGRAM MODE]:", mode);
  console.log("[TELEGRAM FLOW]:", mode);

  if (mode === "image") {
    if (latest.uxHintImage < 2) {
      await telegramSendMessage(token, chatId, `🎨 Сейчас режим генерации. Просто опиши картинку.\n\n${modeFooterLine("image")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      await prisma.telegramChat.update({
        where: { id: latest.id },
        data: { uxHintImage: { increment: 1 } },
      });
    }
    await telegramSendMessage(token, chatId, `⏳ Генерирую изображение...\n\n${modeFooterLine("image")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    try {
      const out = await runImagePipeline({ bot, rawPrompt: text });
      console.log("[TELEGRAM IMAGE FLOW] prompt:", out.prompt);
      console.log("[TELEGRAM IMAGE FLOW] jobId:", out.jobId);
      console.log("[TELEGRAM IMAGE FLOW] result:", JSON.stringify({ url: out.url, hasUrls: Boolean(out.result?.urls) }));
      await telegramSendPhoto(token, chatId, out.url, modeFooterLine("image"), MODE_INLINE_REPLY_MARKUP);
    } catch (err) {
      process.stderr.write(`[telegram] image pipeline: ${err.message}\n`);
      console.log("[TELEGRAM IMAGE FLOW] error:", err.message);
      await telegramSendMessage(token, chatId, `❌ Ошибка генерации\n\n${modeFooterLine("image")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
    }
    return { ok: true };
  }

  if (latest.uxHintChat < 2) {
    await telegramSendMessage(token, chatId, `🧠 Сейчас режим чата. Можешь писать что угодно.\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    await prisma.telegramChat.update({
      where: { id: latest.id },
      data: { uxHintChat: { increment: 1 } },
    });
  }

  try {
    const replyText = await ollamaTelegramChat(bot, latest, text);
    await telegramSendMessage(token, chatId, `${replyText || "…"}\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
  } catch (err) {
    process.stderr.write(`[telegram] chat: ${err.message}\n`);
    await telegramSendMessage(token, chatId, `Ошибка чата: ${err.message}\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
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
