"use strict";

/**
 * Telegram integration: HTTP calls to Telegram API, DB, Ollama-only chat + BullMQ image queue.
 * Text replies use direct Ollama /api/chat only (not the dashboard widget chat path).
 */

const crypto = require("crypto");
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
const KB_ROW_POST = "📝 Пост";

/** Маркетинговый баннер к посту: вкл. по умолчанию, отключить: TELEGRAM_POST_IMAGE=0 */
const TELEGRAM_POST_IMAGE_ENABLED = String(process.env.TELEGRAM_POST_IMAGE || "1") !== "0";
/** После темы спросить «Нужна картинка?» (если TELEGRAM_POST_IMAGE=1). Отключить: TELEGRAM_POST_ASK_IMAGE=0 */
const TELEGRAM_POST_ASK_IMAGE = String(process.env.TELEGRAM_POST_ASK_IMAGE || "1") !== "0";

/** FSM поста (только при mode === "post"); chat mode использует greeting|qualify|… */
const POST_STATE_IDLE = "post_idle";
const POST_STATE_WAITING_TOPIC = "post_waiting_topic";
const POST_STATE_READY = "post_ready";

/** Inline mode switcher — прикрепляем к ответам бота. */
const MODE_INLINE_REPLY_MARKUP = {
  inline_keyboard: [
    [{ text: "🎨 Генерация", callback_data: "mode_image" }],
    [{ text: "🧠 Чат", callback_data: "mode_chat" }],
    [{ text: "📝 Пост", callback_data: "mode_post" }],
  ],
};

const POST_IMAGE_ASK_MARKUP = {
  inline_keyboard: [
    [{ text: "Да ✅", callback_data: "post_img_yes" }],
    [{ text: "Нет", callback_data: "post_img_no" }],
  ],
};

/** SMM: стиль, площадка, тон + переключение режимов */
const POST_SMM_SETTINGS_MARKUP = {
  inline_keyboard: [
    [
      { text: "💰 Продажа", callback_data: "post_sty_sales" },
      { text: "📚 Экспертный", callback_data: "post_sty_expert" },
    ],
    [
      { text: "📖 История", callback_data: "post_sty_story" },
      { text: "📢 Реклама", callback_data: "post_sty_ad" },
    ],
    [
      { text: "📱 Telegram", callback_data: "post_plt_tg" },
      { text: "📸 Instagram", callback_data: "post_plt_ig" },
      { text: "🛒 Avito", callback_data: "post_plt_avito" },
    ],
    [
      { text: "😊 Дружелюбно", callback_data: "post_tone_friend" },
      { text: "⚡ Агрессивно", callback_data: "post_tone_aggr" },
      { text: "✨ Премиум", callback_data: "post_tone_prem" },
    ],
    ...MODE_INLINE_REPLY_MARKUP.inline_keyboard,
  ],
};

const DEFAULT_POST_STYLE = "expert";
const DEFAULT_POST_PLATFORM = "telegram";
const DEFAULT_POST_TONE = "friendly";

function modeFooterLine(mode) {
  if (mode === "image") return "Текущий режим: 🎨 генерация";
  if (mode === "post") return "Текущий режим: 📝 пост";
  return "Текущий режим: 🧠 чат";
}

function triggersPostModeSwitch(text) {
  const s = String(text).toLowerCase();
  return s.includes("пост") || s.includes("сделай пост") || s.includes("напиши пост");
}

function isBarePostTopic(topic) {
  const t = typeof topic === "string" ? topic.trim() : "";
  return t.length < 2;
}

function stripPostTriggers(text) {
  let s = String(text);
  s = s.replace(/\s*напиши\s+пост\s*/gi, " ");
  s = s.replace(/\s*сделай\s+пост\s*/gi, " ");
  s = s.replace(/\bпост\b/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

function extractHttpLinks(text) {
  const re = /https?:\/\/[^\s<>)]+/gi;
  const raw = String(text);
  const links = raw.match(re) || [];
  const plainText = raw.replace(re, " ").replace(/\s+/g, " ").trim();
  return { links, plainText };
}

const LINK_FETCH_TIMEOUT_MS = 12_000;
const LINK_FETCH_MAX_BYTES = 500_000;
const LINK_SOURCE_MAX_TOTAL = 2000;
const LINK_FETCH_MAX_URLS = 5;

function isAllowedPostLinkFetchUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return false;
    return true;
  } catch {
    return false;
  }
}

function stripHtmlTagsInner(text) {
  return String(text)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code >= 32 && code < 0x110000 ? String.fromCharCode(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return code >= 32 && code < 0x110000 ? String.fromCharCode(code) : " ";
    })
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Только title, h1, meta description (без body/nav/footer).
 */
function extractMetaFromHtml(html) {
  const s = String(html);
  let title = "";
  const mt = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (mt) title = stripHtmlTagsInner(mt[1]).slice(0, 600);
  let h1 = "";
  const m1 = s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m1) h1 = stripHtmlTagsInner(m1[1]).slice(0, 600);
  let description = "";
  let md =
    s.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    s.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  if (md) description = stripHtmlTagsInner(md[1]).slice(0, 900);
  if (!description) {
    const og = s.match(
      /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i
    );
    if (og) description = stripHtmlTagsInner(og[1]).slice(0, 900);
  }
  return { title, h1, description };
}

async function fetchUrlHtmlString(urlStr) {
  if (!isAllowedPostLinkFetchUrl(urlStr)) throw new Error("URL not allowed");
  const res = await fetch(urlStr, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; NeekloPostBot/1.0; +https://site-al.ru)",
      Accept: "text/html, */*",
    },
    signal: AbortSignal.timeout(LINK_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > LINK_FETCH_MAX_BYTES) throw new Error("response too large");
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/**
 * @returns {Promise<string>} блок «Контекст из источника:» (≤2000 символов всего)
 */
async function fetchPostSourceContext(links) {
  const uniq = [...new Set((Array.isArray(links) ? links : []).filter(Boolean).map(String))].slice(
    0,
    LINK_FETCH_MAX_URLS
  );
  const parts = [];
  let total = 0;
  for (const url of uniq) {
    if (!isAllowedPostLinkFetchUrl(url)) continue;
    try {
      const html = await fetchUrlHtmlString(url);
      const { title, h1, description } = extractMetaFromHtml(html);
      const block = `${url}\ntitle: ${title}\nh1: ${h1}\ndescription: ${description}`;
      if (total + block.length + 2 > LINK_SOURCE_MAX_TOTAL) break;
      parts.push(block);
      total += block.length + 2;
      console.log("[telegram-post] RAW link meta", { url, title: title.slice(0, 80), h1Len: h1.length, descLen: description.length });
    } catch (e) {
      process.stderr.write(`[post link fetch] RAW ${url} ${e.stack || e.message}\n`);
    }
  }
  if (!parts.length) return "";
  const body = parts.join("\n\n---\n\n").slice(0, LINK_SOURCE_MAX_TOTAL);
  return `Контекст из источника:\n${body}`;
}

function resolvePostStyle(row) {
  const s = row && row.postStyle;
  if (s === "sales" || s === "expert" || s === "story" || s === "ad") return s;
  return DEFAULT_POST_STYLE;
}

function resolvePostPlatform(row) {
  const p = row && row.postPlatform;
  if (p === "telegram" || p === "instagram" || p === "avito") return p;
  return DEFAULT_POST_PLATFORM;
}

function resolvePostTone(row) {
  const t = row && row.postTone;
  if (t === "friendly" || t === "aggressive" || t === "premium") return t;
  return DEFAULT_POST_TONE;
}

function buildPostStyleBlock(style) {
  if (style === "sales") {
    return `
СТИЛЬ «ПРОДАЖА»:
— Агрессивный призыв к действию (CTA), выгоды в первых строках, срочность и ограничение по времени/количеству где уместно.
— Акцент на выгодах клиента и снятии возражений.`;
  }
  if (style === "expert") {
    return `
СТИЛЬ «ЭКСПЕРТНЫЙ»:
— Образовательный тон, структурированная подача, ощущение экспертности и авторитета без пустой воды.`;
  }
  if (style === "story") {
    return `
СТИЛЬ «ИСТОРИЯ»:
— Повествование, эмоциональный зацеп в начале, развитие мысли, логичный вывод к действию.`;
  }
  if (style === "ad") {
    return `
СТИЛЬ «РЕКЛАМА»:
— Коротко, ударно, прямое предложение, минимум лишних слов.`;
  }
  return "";
}

function buildPostPlatformBlock(platform) {
  if (platform === "instagram") {
    return `
ПЛАТФОРМА Instagram:
— Короткие абзацы, уместные эмодзи, живой вовлекающий тон, без перегруза.`;
  }
  if (platform === "avito") {
    return `
ПЛАТФОРМА Avito:
— Без «воды», маркированные пункты где уместно, чёткое предложение, при необходимости плейсхолдер цены: [ЦЕНА].`;
  }
  return `
ПЛАТФОРМА Telegram:
— Полноценный структурированный пост с читаемой подачей.`;
}

function buildPostToneLine(tone) {
  const map = {
    friendly: "дружелюбный, на «ты» или нейтрально-теплый",
    aggressive: "напористый, прямой, без смягчений",
    premium: "премиальный, сдержанный, акцент на качестве и статусе",
  };
  return map[tone] || map.friendly;
}

/**
 * Промпт SMM-поста (агентский уровень).
 * @param {object} p
 */
function buildPostPrompt(p) {
  const topic = typeof p.topic === "string" ? p.topic.trim() : "";
  const arr = Array.isArray(p.links) ? p.links.filter(Boolean) : [];
  const style = p.style || DEFAULT_POST_STYLE;
  const platform = p.platform || DEFAULT_POST_PLATFORM;
  const tone = p.tone || DEFAULT_POST_TONE;
  const sourceCtx = typeof p.sourceContext === "string" ? p.sourceContext.trim() : "";
  const lastPosts = Array.isArray(p.lastPosts) ? p.lastPosts.filter(Boolean).map(String) : [];

  const linksBlock =
    arr.length > 0
      ? `\nСсылки (не выдумывай факты вне темы и источников):\n${arr.map((u) => `— ${u}`).join("\n")}`
      : "";
  const srcBlock = sourceCtx ? `\n\n${sourceCtx}` : "";
  const antiDup =
    lastPosts.length > 0
      ? `\n\nНЕ повторяй стиль и формулировки этих текстов:\n${lastPosts.map((t, i) => `--- ${i + 1} ---\n${t.slice(0, 1200)}`).join("\n\n")}`
      : "";

  return `
Ты профессиональный SMM-специалист и копирайтер.

Стиль бренда (тон): ${buildPostToneLine(tone)} (${tone})

Тема поста: ${topic}
${buildPostStyleBlock(style)}
${buildPostPlatformBlock(platform)}
${linksBlock}${srcBlock}${antiDup}

Сформируй финальный текст поста на русском языке согласно стилю и платформе выше.

Оформи результат с эмодзи уместно для выбранной платформы:
🔥 Заголовок / зацеп

Основной текст

📌 Ключевые моменты / выгоды

👉 Призыв к действию
`.trim();
}

const POST_SYSTEM_PROMPT = `
Ты профессиональный маркетолог. Выполняй инструкцию в сообщении пользователя буквально.
Не упоминай, что ты ИИ. Пиши только по-русски.
`.trim();

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

/**
 * Динамический sales-слой для chat mode (FSM).
 * @param {string} state
 * @param {Record<string, unknown>} leadData
 */
function buildSalesPrompt(state, leadData) {
  void leadData;
  if (state === "greeting") {
    return `
Ты дружелюбный менеджер.

Цель:
поздороваться и понять, чем помочь.

Не продавай сразу.
Задай 1 вопрос.
`.trim();
  }
  if (state === "qualify") {
    return `
Твоя задача:
понять потребность клиента.

Задай уточняющие вопросы:
— что нужно
— для чего
— сроки
`.trim();
  }
  if (state === "offer") {
    return `
Предложи решение.

Объясни:
— что получит клиент
— почему это ему подходит
`.trim();
  }
  if (state === "close") {
    return `
Мягко доведи до действия:

— оставить контакт
— перейти дальше
`.trim();
  }
  return buildSalesPrompt("greeting", leadData);
}

function computeNextSalesState(state, text, history) {
  const t = typeof text === "string" ? text.trim() : "";
  const userMsgCount = Array.isArray(history) ? history.filter((m) => m.role === "user").length : 0;
  const hasQualifyData = t.length >= 22 || userMsgCount >= 2;

  if (state === "greeting") return "qualify";
  if (state === "qualify") return hasQualifyData ? "offer" : "qualify";
  if (state === "offer") return "close";
  if (state === "close") return "close";
  return "qualify";
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

async function telegramSetWebhook(token, webhookUrl, secretToken) {
  const body = { url: webhookUrl };
  if (secretToken) body.secret_token = secretToken;
  return tgRequest("POST", token, "/setWebhook", body);
}

const TELEGRAM_MAX_MESSAGE_CHARS = 4000;

async function telegramSendMessage(token, chatId, text, extra = {}) {
  return tgRequest("POST", token, "/sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: extra.parseMode || undefined,
    reply_markup: extra.replyMarkup || undefined,
  });
}

/** Длинные ответы: разбиение по лимиту Telegram (4096, запас 4000). */
async function telegramSendLongMessage(token, chatId, text, extra = {}) {
  const raw = typeof text === "string" ? text : String(text);
  if (raw.length <= TELEGRAM_MAX_MESSAGE_CHARS) {
    return telegramSendMessage(token, chatId, raw, extra);
  }
  const parts = [];
  for (let i = 0; i < raw.length; i += TELEGRAM_MAX_MESSAGE_CHARS) {
    parts.push(raw.slice(i, i + TELEGRAM_MAX_MESSAGE_CHARS));
  }
  console.log("[telegram-post] RAW split long message", { parts: parts.length, totalLen: raw.length });
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    await telegramSendMessage(token, chatId, parts[i], isLast ? extra : {});
  }
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
  const webhookSecretToken = crypto.randomBytes(24).toString("hex");

  const bot = await prisma.telegramBot.create({
    data: {
      userId,
      organizationId,
      botToken: token,
      botUsername,
      webhookSecretToken,
    },
  });

  const webhookUrl = `${WEBHOOK_BASE}/telegram/webhook/${bot.id}`;
  try {
    await telegramSetWebhook(token, webhookUrl, webhookSecretToken);
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

/**
 * @param {object} [options]
 * @param {string} [options.systemPromptOverride] — полностью заменяет базовый + sales system (например режим «пост»).
 * @param {boolean} [options.skipSalesFsm]
 * @param {string} [options.userContentForModel] — текст в роли user для модели (если не задан — `text`).
 * @param {boolean} [options.useEmptyHistory] — без истории диалога (пост).
 * @param {boolean} [options.skipFsmUpdate] — не менять FSM state (пост).
 */
async function ollamaTelegramChat(bot, tgChat, text, options = {}) {
  const {
    systemPromptOverride = null,
    skipSalesFsm = false,
    userContentForModel = null,
    useEmptyHistory = false,
    skipFsmUpdate = false,
  } = options;

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

  const state = tgChat.state || "greeting";
  const rawHistory = Array.isArray(conv.messages) ? conv.messages : [];
  const history = useEmptyHistory ? [] : rawHistory;
  const userLine = userContentForModel != null ? String(userContentForModel) : text;
  const leadData = { lastUserText: userLine, userMsgCountBefore: history.filter((m) => m.role === "user").length };

  let systemPromptFinal;
  if (systemPromptOverride != null && String(systemPromptOverride).trim()) {
    systemPromptFinal = `
${String(systemPromptOverride).trim()}

ВАЖНО:
— думай и пиши только на русском языке
— не используй английские конструкции без необходимости
`.trim();
  } else {
    const finalPrompt = buildTelegramFinalSystemPrompt(agent);
    const salesBlock = skipSalesFsm ? "" : buildSalesPrompt(state, leadData);
    systemPromptFinal = `
${finalPrompt}

${salesBlock}

ВАЖНО:
— думай на русском языке
— формируй ответ сразу на русском
— не используй английские конструкции
— если возникает английская фраза — перепиши её на русский ДО отправки

КРИТИЧНО:
не «переводи», а изначально отвечай на русском — без смешения языков.
`.trim();
  }

  const fullMessages = [];
  if (systemPromptFinal.trim()) {
    fullMessages.push({ role: "system", content: systemPromptFinal.trim() });
  }
  fullMessages.push(...history, { role: "user", content: userLine });

  process.stdout.write(
    `[telegram:chat] conv=${conversationId} try_model=${model} ctx=${history.length} post=${Boolean(systemPromptOverride)}\n`
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

  const updatedMessages = [...rawHistory, { role: "user", content: userLine }, { role: "assistant", content: reply }];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data: { messages: updatedMessages },
  });

  if (!skipFsmUpdate) {
    const newState = computeNextSalesState(state, userLine, rawHistory);
    console.log("[FSM STATE]:", state, "→", newState);
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: { conversationId, state: newState },
    });
  } else {
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: { conversationId },
    });
  }

  return reply;
}

/**
 * Очередь картинки без блокировки webhook: ожидание job в фоне, затем sendPhoto.
 * @param {string} [platform] — telegram | instagram | avito
 */
function enqueueMarketingBannerImage({ bot, token, chatId, topic, platform }) {
  const plat = platform || "telegram";
  const rawPrompt =
    `advertising banner, high-end commercial design, clean typography, brand style, ` +
    `professional marketing visual, modern minimalistic layout, premium lighting, ` +
    `${topic}, social ad for ${plat} platform`;
  void (async () => {
    let queueEvents;
    try {
      console.log("[telegram-post] RAW image job prompt base", rawPrompt.slice(0, 300));
      const brain = analyzePrompt(rawPrompt);
      const enh = await enhancePrompt(rawPrompt, { brain });
      const improvedPrompt = enh.enhancedPrompt || rawPrompt;
      const negativePrompt = enh.negativePrompt || DEFAULT_NEGATIVE;
      const queue = getImageQueue();
      const jobId = uuidv4();
      const job = await queue.add(
        "generate",
        {
          prompt: improvedPrompt,
          negativePrompt,
          originalPrompt: rawPrompt,
          width: 1024,
          height: 1024,
          userId: bot.userId,
          organizationId: bot.organizationId,
          jobId,
          mode: "text",
          variations: 1,
          seed: Math.floor(Math.random() * 999999),
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 3000 },
        }
      );
      const connection = getWorkerConnection();
      queueEvents = new QueueEvents("image-generation", { connection });
      const result = await job.waitUntilFinished(queueEvents, 180_000);
      const url = result?.url || (Array.isArray(result?.urls) && result.urls[0]);
      if (!url) {
        process.stderr.write("[telegram] post banner: no URL in job result RAW\n");
        await telegramSendMessage(token, chatId, "⚠️ Не удалось сгенерировать изображение", {
          replyMarkup: MODE_INLINE_REPLY_MARKUP,
        }).catch((e) => console.error("[telegram] post banner notify fail RAW", e));
        return;
      }
      await telegramSendPhoto(token, chatId, url, modeFooterLine("post"), MODE_INLINE_REPLY_MARKUP);
    } catch (err) {
      process.stderr.write(`[telegram] post banner async RAW: ${err.stack || err.message}\n`);
      console.error("[telegram] post banner image job failed RAW", err);
      await telegramSendMessage(token, chatId, "⚠️ Не удалось сгенерировать изображение", {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      }).catch((e) => console.error("[telegram] post banner error send RAW", e));
    } finally {
      if (queueEvents) await queueEvents.close().catch(() => {});
    }
  })();
}

const POST_MODE_USER_ERROR =
  "⚠️ Ошибка генерации поста. Попробуйте ещё раз.";

async function notifyPostModeUserError(token, chatId) {
  await telegramSendMessage(token, chatId, POST_MODE_USER_ERROR, {
    replyMarkup: MODE_INLINE_REPLY_MARKUP,
  });
}

/**
 * Генерация поста вне HTTP webhook (не блокирует ответ Telegram).
 */
async function runPostGenerationDeferred({
  botId,
  tgChatId,
  token,
  chatId,
  topic,
  links,
  includeImage,
}) {
  try {
    const bot = await prisma.telegramBot.findFirst({ where: { id: botId, isActive: true } });
    const tgChat = await prisma.telegramChat.findUnique({ where: { id: tgChatId } });
    if (!bot || !tgChat) {
      const err = new Error(!bot ? "TelegramBot not found or inactive" : "TelegramChat not found");
      console.error("[POST MODE ERROR]", err);
      await notifyPostModeUserError(token, chatId).catch((sendErr) => {
        console.error("[POST MODE ERROR] notify failed", sendErr);
      });
      return;
    }

    const topicStr = typeof topic === "string" ? topic.trim() : "";
    console.log("[TELEGRAM POST MODE]", `topic: ${topicStr.slice(0, 400)}`, `image: ${includeImage ? "yes" : "no"}`);

    await telegramSendMessage(token, chatId, "⏳ Генерирую пост...", {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    }).catch((e) => console.error("[telegram-post] loading msg RAW", e));

    const linkArr = Array.isArray(links) ? links : [];
    const sourceContext = linkArr.length ? await fetchPostSourceContext(linkArr) : "";
    const style = resolvePostStyle(tgChat);
    const platform = resolvePostPlatform(tgChat);
    const tone = resolvePostTone(tgChat);
    const rawLast = tgChat.postLastGenerated;
    const prevLast = Array.isArray(rawLast) ? rawLast.map(String) : [];

    const postPrompt = buildPostPrompt({
      topic: topicStr,
      links: linkArr,
      sourceContext,
      style,
      platform,
      tone,
      lastPosts: prevLast,
    });
    console.log("[telegram-post] RAW prompt len", postPrompt.length, "style", style, "platform", platform, "tone", tone);

    const replyText = await ollamaTelegramChat(bot, tgChat, "", {
      systemPromptOverride: POST_SYSTEM_PROMPT,
      skipSalesFsm: true,
      userContentForModel: postPrompt,
      useEmptyHistory: true,
      skipFsmUpdate: true,
    });
    const outText = `${replyText || "…"}\n\n${modeFooterLine("post")}`;
    await telegramSendLongMessage(token, chatId, outText, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });

    const nextLast = [...prevLast, (replyText || "").slice(0, 12_000)].slice(-3);
    if (includeImage) {
      enqueueMarketingBannerImage({
        bot,
        token,
        chatId,
        topic: topicStr,
        platform,
      });
    }
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: {
        state: POST_STATE_IDLE,
        postDraftTopic: null,
        postDraftLinks: null,
        postLastGenerated: nextLast,
      },
    });
  } catch (e) {
    console.error("[POST MODE ERROR]", e);
    await notifyPostModeUserError(token, chatId).catch((sendErr) => {
      console.error("[POST MODE ERROR] notify failed", sendErr);
    });
  }
}

/**
 * Тема собрана: либо вопрос про картинку (post_ready + черновик), либо сразу генерация.
 */
async function schedulePostOrAskImage(bot, latest, token, chatId, topic, links) {
  const topicStr = typeof topic === "string" ? topic.trim() : "";
  if (topicStr.length < 2) {
    await prisma.telegramChat.update({
      where: { id: latest.id },
      data: { state: POST_STATE_WAITING_TOPIC },
    });
    await telegramSendMessage(token, chatId, `Напишите тему поста\n\n${modeFooterLine("post")}`, {
      replyMarkup: POST_SMM_SETTINGS_MARKUP,
    });
    return;
  }
  const ask = TELEGRAM_POST_ASK_IMAGE && TELEGRAM_POST_IMAGE_ENABLED;
  if (ask) {
    await prisma.telegramChat.update({
      where: { id: latest.id },
      data: {
        state: POST_STATE_READY,
        postDraftTopic: topicStr,
        postDraftLinks: links && links.length ? links : null,
      },
    });
    await telegramSendMessage(token, chatId, `Нужна картинка к посту?\n\n${modeFooterLine("post")}`, {
      replyMarkup: POST_IMAGE_ASK_MARKUP,
    });
    return;
  }
  runPostGenerationDeferred({
    botId: bot.id,
    tgChatId: latest.id,
    token,
    chatId,
    topic: topicStr,
    links: links || [],
    includeImage: TELEGRAM_POST_IMAGE_ENABLED,
  }).catch((err) => {
    console.error("[POST MODE ERROR]", err);
    notifyPostModeUserError(token, chatId).catch((sendErr) => {
      console.error("[POST MODE ERROR] notify failed", sendErr);
    });
  });
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

    if (data === "post_img_yes" || data === "post_img_no") {
      await telegramAnswerCallbackQuery(token, cq.id);
      const row = await prisma.telegramChat.findUnique({ where: { id: tgChat.id } });
      if (!row || row.mode !== "post") {
        return { ok: true };
      }
      if (row.state !== POST_STATE_READY || !row.postDraftTopic) {
        await telegramSendMessage(token, chatId, `Напишите тему поста заново.\n\n${modeFooterLine("post")}`, {
          replyMarkup: POST_SMM_SETTINGS_MARKUP,
        });
        return { ok: true };
      }
      const topicStr = row.postDraftTopic;
      const draftLinks = row.postDraftLinks;
      const links = Array.isArray(draftLinks) ? draftLinks.map(String) : [];
      const includeImage = data === "post_img_yes";
      await prisma.telegramChat.update({
        where: { id: row.id },
        data: {
          state: POST_STATE_IDLE,
          postDraftTopic: null,
          postDraftLinks: null,
        },
      });
      runPostGenerationDeferred({
        botId: bot.id,
        tgChatId: row.id,
        token,
        chatId,
        topic: topicStr,
        links,
        includeImage,
      }).catch((err) => {
        console.error("[POST MODE ERROR]", err);
        notifyPostModeUserError(token, chatId).catch((sendErr) => {
          console.error("[POST MODE ERROR] notify failed", sendErr);
        });
      });
      return { ok: true };
    }

    const postStyleCb = {
      post_sty_sales: "sales",
      post_sty_expert: "expert",
      post_sty_story: "story",
      post_sty_ad: "ad",
    };
    if (postStyleCb[data]) {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: { postStyle: postStyleCb[data] },
      });
      await telegramAnswerCallbackQuery(token, cq.id, { text: `Стиль: ${postStyleCb[data]}` });
      console.log("[telegram-post] RAW postStyle", postStyleCb[data]);
      return { ok: true };
    }
    const postPltCb = {
      post_plt_tg: "telegram",
      post_plt_ig: "instagram",
      post_plt_avito: "avito",
    };
    if (postPltCb[data]) {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: { postPlatform: postPltCb[data] },
      });
      await telegramAnswerCallbackQuery(token, cq.id, { text: `Площадка: ${postPltCb[data]}` });
      console.log("[telegram-post] RAW postPlatform", postPltCb[data]);
      return { ok: true };
    }
    const postToneCb = {
      post_tone_friend: "friendly",
      post_tone_aggr: "aggressive",
      post_tone_prem: "premium",
    };
    if (postToneCb[data]) {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: { postTone: postToneCb[data] },
      });
      await telegramAnswerCallbackQuery(token, cq.id, { text: `Тон: ${postToneCb[data]}` });
      console.log("[telegram-post] RAW postTone", postToneCb[data]);
      return { ok: true };
    }

    if (data === "mode_chat") {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: {
          mode: "chat",
          state: "greeting",
          postDraftTopic: null,
          postDraftLinks: null,
        },
      });
      await telegramAnswerCallbackQuery(token, cq.id);
      console.log("[TELEGRAM MODE]: chat");
      console.log("[TELEGRAM FLOW]: chat");
      await telegramSendMessage(token, chatId, `🧠 Режим чата включен\n\n${modeFooterLine("chat")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      return { ok: true };
    }
    if (data === "mode_image") {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: {
          mode: "image",
          state: "greeting",
          postDraftTopic: null,
          postDraftLinks: null,
        },
      });
      await telegramAnswerCallbackQuery(token, cq.id);
      console.log("[TELEGRAM MODE]: image");
      console.log("[TELEGRAM FLOW]: image");
      await telegramSendMessage(token, chatId, `🎨 Режим генерации включен\n\n${modeFooterLine("image")}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      return { ok: true };
    }
    if (data === "mode_post") {
      await prisma.telegramChat.update({
        where: { id: tgChat.id },
        data: { mode: "post", state: POST_STATE_WAITING_TOPIC },
      });
      await telegramAnswerCallbackQuery(token, cq.id);
      console.log("[TELEGRAM MODE]: post");
      console.log("[TELEGRAM FLOW]: post");
      await telegramSendMessage(token, chatId, `Напишите тему поста\n\n${modeFooterLine("post")}`, {
        replyMarkup: POST_SMM_SETTINGS_MARKUP,
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

  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const caption = msg.caption != null ? String(msg.caption).trim() : "";
    if (!caption) {
      await telegramSendMessage(token, chatId, "Пришлите фото с подписью — это сценарий для видео (и озвучки TTS).", {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
      return { ok: true };
    }
    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const gf = await tgRequest("GET", token, `/getFile?file_id=${encodeURIComponent(fileId)}`);
      const fp = gf.result && gf.result.file_path ? String(gf.result.file_path) : "";
      if (!fp) throw new Error("no file_path");
      const imageUrl = `https://api.telegram.org/file/bot${token}/${fp}`;
      const { createAndEnqueueVideoJob } = require("../../services/videoGeneration");
      console.log("[VIDEO PIPELINE] step: telegram_enqueue RAW", { chatId: String(chatId) });
      await createAndEnqueueVideoJob({
        userId: bot.userId,
        organizationId: bot.organizationId,
        imageUrl,
        script: caption,
        voiceText: caption,
        notify: { type: "telegram", token, chatId },
      });
      await telegramSendMessage(token, chatId, "⏳ Видео в очереди. Пришлю сюда, когда будет готово.", {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
    } catch (e) {
      process.stderr.write(`[VIDEO PIPELINE] telegram enqueue error RAW: ${e.stack || e.message}\n`);
      await telegramSendMessage(token, chatId, `Не удалось поставить видео в очередь: ${e.message}`, {
        replyMarkup: MODE_INLINE_REPLY_MARKUP,
      });
    }
    return { ok: true };
  }

  if (text === KB_ROW_PHOTO) {
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: {
        mode: "image",
        state: "greeting",
        postDraftTopic: null,
        postDraftLinks: null,
      },
    });
    console.log("[TELEGRAM MODE]: image");
    console.log("[TELEGRAM FLOW]: image");
    await telegramSendMessage(token, chatId, `🎨 Режим генерации включен\n\n${modeFooterLine("image")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    return { ok: true };
  }
  if (text === KB_ROW_CHAT) {
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: {
        mode: "chat",
        state: "greeting",
        postDraftTopic: null,
        postDraftLinks: null,
      },
    });
    console.log("[TELEGRAM MODE]: chat");
    console.log("[TELEGRAM FLOW]: chat");
    await telegramSendMessage(token, chatId, `🧠 Режим чата включен\n\n${modeFooterLine("chat")}`, {
      replyMarkup: MODE_INLINE_REPLY_MARKUP,
    });
    return { ok: true };
  }
  if (text === KB_ROW_POST) {
    await prisma.telegramChat.update({
      where: { id: tgChat.id },
      data: { mode: "post", state: POST_STATE_WAITING_TOPIC },
    });
    console.log("[TELEGRAM MODE]: post");
    console.log("[TELEGRAM FLOW]: post");
    await telegramSendMessage(token, chatId, `Напишите тему поста\n\n${modeFooterLine("post")}`, {
      replyMarkup: POST_SMM_SETTINGS_MARKUP,
    });
    return { ok: true };
  }

  if (!text.trim()) {
    return { ok: true, skipped: true };
  }

  const latest = await prisma.telegramChat.findUnique({ where: { id: tgChat.id } });
  if (!latest) {
    return { ok: true, skipped: true };
  }

  const { links, plainText } = extractHttpLinks(text);

  if (triggersPostModeSwitch(text)) {
    await prisma.telegramChat.update({
      where: { id: latest.id },
      data: { mode: "post", state: POST_STATE_WAITING_TOPIC },
    });
    const topic = stripPostTriggers(plainText || text);
    if (isBarePostTopic(topic)) {
      await telegramSendMessage(token, chatId, `Напишите тему поста\n\n${modeFooterLine("post")}`, {
        replyMarkup: POST_SMM_SETTINGS_MARKUP,
      });
      return { ok: true };
    }
    const refreshed = await prisma.telegramChat.findUnique({ where: { id: latest.id } });
    await schedulePostOrAskImage(bot, refreshed || latest, token, chatId, topic, links);
    return { ok: true };
  }

  const mode = latest.mode || "chat";

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

  if (mode === "post") {
    const st = latest.state || POST_STATE_IDLE;
    let topic = plainText.length >= 2 ? plainText : text.trim();
    const linksForPost = links;

    if (st === POST_STATE_READY && topic.length >= 2) {
      await prisma.telegramChat.update({
        where: { id: latest.id },
        data: { postDraftTopic: null, postDraftLinks: null, state: POST_STATE_WAITING_TOPIC },
      });
    }

    if (isBarePostTopic(topic)) {
      await prisma.telegramChat.update({
        where: { id: latest.id },
        data: { state: POST_STATE_WAITING_TOPIC },
      });
      await telegramSendMessage(token, chatId, `Напишите тему поста\n\n${modeFooterLine("post")}`, {
        replyMarkup: POST_SMM_SETTINGS_MARKUP,
      });
      return { ok: true };
    }

    const refreshed = await prisma.telegramChat.findUnique({ where: { id: latest.id } });
    await schedulePostOrAskImage(bot, refreshed || latest, token, chatId, topic, linksForPost);
    return { ok: true };
  }

  if (mode === "chat") {
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
  KB_ROW_POST,
};
