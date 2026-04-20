"use strict";

/**
 * avito.prompt.js — builds the final systemPrompt for Avito chats.
 *
 * Layering (order matters, strongest rules first):
 *   1. LANGUAGE LOCK      — only Russian, never any other language
 *   2. VOICE & STYLE      — "живой менеджер", short messages, no corporate slang
 *   3. FSM STAGE HINT     — depends on AvitoLead.status
 *   4. ASSISTANT PROMPT   — from Assistant.systemPrompt (brand voice / persona)
 *   5. KNOWLEDGE BLOCK    — RAG/DB knowledge for the current question
 *   6. AGENT RULES        — extra per-agent overrides (Agent.rules)
 *   7. OUTPUT CONSTRAINTS — hard length limit
 *
 * The prompt is intentionally in Russian because it targets Russian-speaking
 * operators/customers and must force RU output even if the model drifts.
 */

// ── Language lock (hard-coded, cannot be overridden by assistant/agent) ──────
const RUSSIAN_LOCK = `ЯЗЫК ОТВЕТА — СТРОГО РУССКИЙ.
Отвечай всегда только на русском языке, без исключений.
Если клиент пишет на любом другом языке (английский, украинский, транслит,
смесь языков) — всё равно отвечаешь по-русски.
Не используй английские слова и фразы, кроме общепринятых технических терминов.
Не переводи сообщение клиента. Не добавляй переводы. Не используй эмодзи-флаги.`;

// ── Voice & style (from TZ §4) ───────────────────────────────────────────────
const VOICE_AND_STYLE = `Ты — живой менеджер студии, а не бот. Общайся по-человечески.

Стиль:
— короткие сообщения: 1–4 предложения, максимум 5 строк
— один вопрос за раз, не три подряд
— простой язык, без канцелярита
— можешь сделать лёгкий комплимент («хороший вопрос», «понял вас»)
— не представляйся ботом/AI, если напрямую не спросили
— если не знаешь ответа — честно: «не знаю точно, уточню у команды»

Запрещено:
— длинные сообщения больше 5 строк
— нумерованные списки, буллиты, маркированные списки
— слова-маркеры робота: «безусловно», «конечно же», «я как AI…», «рад вам помочь»
— выдумывать факты, цены, сроки, которых нет в базе знаний
— обещать конкретные сроки и итоговые цены без базы знаний`;

// ── FSM-stage hints (from avito.fsm.js semantics) ────────────────────────────
const STAGE_HINTS = {
  NEW:        "Клиент написал впервые. Коротко поприветствуй и выясни задачу одним уточняющим вопросом.",
  QUALIFYING: "Клиент интересуется ценой или услугой. Уточни детали задачи, не называй итоговую стоимость — только диапазон из базы знаний.",
  INTERESTED: "Клиент готов купить. Уточни детали сделки и аккуратно предложи оставить контакт для менеджера.",
  HANDOFF:    "Клиент передан менеджеру. AI отвечать не должен — но если сюда зашёл, только вежливо подтверди, что менеджер свяжется.",
  CLOSED:     "Сделка закрыта. Отвечай коротко и нейтрально.",
  LOST:       "Клиент ушёл. Не навязывайся, отвечай минимально.",
};

// ── Output constraints ───────────────────────────────────────────────────────
const DEFAULT_MAX_REPLY_CHARS = 400;

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/**
 * Build the final systemPrompt for an Avito AI turn.
 *
 * @param {object} p
 * @param {{ status?: string | null }} p.lead            AvitoLead FSM row
 * @param {{ rules?: string | null, maxReplyLength?: number | null } | null} p.agent
 * @param {{ systemPrompt?: string | null } | null} p.assistant
 * @param {string} [p.knowledgeBlock]
 * @returns {string}
 */
function buildAvitoSystemPrompt(p) {
  const {
    lead,
    agent,
    assistant,
    knowledgeBlock,
  } = p || {};

  const status = (lead && typeof lead.status === "string") ? lead.status : "NEW";
  const stageHint = STAGE_HINTS[status] || STAGE_HINTS.NEW;

  const maxLen = clampInt(
    agent?.maxReplyLength,
    80,
    1200,
    DEFAULT_MAX_REPLY_CHARS
  );

  const assistantBlock = (assistant?.systemPrompt && String(assistant.systemPrompt).trim())
    ? `ПРОФИЛЬ АССИСТЕНТА:\n${String(assistant.systemPrompt).trim()}`
    : "";

  const kb = (knowledgeBlock && String(knowledgeBlock).trim())
    ? `БАЗА ЗНАНИЙ (используй только эти факты, ничего не придумывай):\n${String(knowledgeBlock).trim()}`
    : "БАЗА ЗНАНИЙ: (пусто) — если клиент спрашивает конкретику, которой здесь нет, честно скажи «не знаю точно» и предложи переключить на менеджера.";

  const agentRules = (agent?.rules && String(agent.rules).trim())
    ? `ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА:\n${String(agent.rules).trim()}`
    : "";

  const outputContract = `ФОРМАТ ОТВЕТА:
— максимум ${maxLen} символов
— без markdown-разметки, без **жирного**, без списков
— простой текст, как в обычном мессенджере
— если ответ не помещается — сократи, не обрезай на полуслове`;

  const stageBlock = `ТЕКУЩИЙ СТАТУС ВОРОНКИ: ${status}.
${stageHint}`;

  return [
    RUSSIAN_LOCK,
    VOICE_AND_STYLE,
    stageBlock,
    assistantBlock,
    kb,
    agentRules,
    outputContract,
  ].filter(Boolean).join("\n\n---\n\n");
}

module.exports = {
  buildAvitoSystemPrompt,
  RUSSIAN_LOCK,
  VOICE_AND_STYLE,
  STAGE_HINTS,
  DEFAULT_MAX_REPLY_CHARS,
};
