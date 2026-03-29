"use strict";

/** Экспорт для подмешивания в agent.rules */
const WIDGET_SALES_BLOCK = `

--- Режим виджета (продажи и лиды) ---
Ты консультант-продавец: помогай выбрать решение, задавай уточняющие вопросы, веди к оформлению заявки.
Когда посетитель проявляет интерес (вопросы о продукте, цене, сроках, демо, «хочу», «интересно», готовность купить/попробовать):
— в том же или следующем сообщении мягко предложи оставить заявку и попроси ИМЯ и ТЕЛЕФОН для обратного звонка (можно одним коротким блоком).
Если имя или телефон уже есть в переписке — не повторяй запрос, поблагодари и уточни следующий шаг.
Можно также предложить email, но телефон — приоритет для быстрой связи.
Отвечай кратко, по делу, без канцелярита и без навязчивости.`;

/**
 * @param {import('fastify').FastifyRequest} request
 */
function isWidgetClientRequest(request) {
  const h = request.headers["x-widget-client"] ?? request.headers["X-Widget-Client"];
  return String(h ?? "").trim() === "1";
}

/**
 * @param {string|null|undefined} basePrompt
 * @returns {string}
 */
function appendWidgetSalesPrompt(basePrompt) {
  const b = String(basePrompt ?? "").trim();
  return b ? `${b}${WIDGET_SALES_BLOCK}` : WIDGET_SALES_BLOCK.trim();
}

/**
 * Список хостов из assistant.settings.widgetAllowedDomains (например ["example.com","*.app.example.com"]).
 * null = ограничений нет.
 * @param {import('@prisma/client').Assistant} assistant
 * @returns {string[]|null}
 */
function getWidgetAllowedDomains(assistant) {
  const s = assistant && assistant.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    return null;
  }
  const obj = /** @type {Record<string, unknown>} */ (s);
  if (!Object.prototype.hasOwnProperty.call(obj, "widgetAllowedDomains")) {
    return null;
  }
  const raw = obj.widgetAllowedDomains;
  if (!Array.isArray(raw)) {
    return null;
  }
  const out = raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  return out;
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {string|null}
 */
function extractBrowserHost(request) {
  const origin = request.headers.origin;
  if (origin) {
    try {
      return new URL(String(origin)).hostname.toLowerCase();
    } catch {
      /* ignore */
    }
  }
  const ref = request.headers.referer;
  if (ref) {
    try {
      return new URL(String(ref)).hostname.toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {string} hostname
 * @param {string} rule
 */
function isHostMatchingRule(hostname, rule) {
  const h = hostname.toLowerCase();
  let r = String(rule).trim().toLowerCase();
  if (!r) {
    return false;
  }
  if (r.startsWith("*.")) {
    r = r.slice(2);
    return h === r || h.endsWith("." + r);
  }
  return h === r;
}

/**
 * @param {import('@prisma/client').Assistant} assistant
 * @param {import('fastify').FastifyRequest} request
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function assertWidgetDomainAllowed(assistant, request) {
  const rules = getWidgetAllowedDomains(assistant);
  if (rules == null) {
    return { ok: true };
  }
  if (rules.length === 0) {
    return { ok: false, error: "Widget domains not configured (empty widgetAllowedDomains)" };
  }
  const host = extractBrowserHost(request);
  if (!host) {
    return { ok: false, error: "Widget requires Origin or Referer for domain check" };
  }
  const ok = rules.some((rule) => isHostMatchingRule(host, rule));
  if (!ok) {
    return { ok: false, error: "Domain not allowed for this assistant" };
  }
  return { ok: true };
}

module.exports = {
  WIDGET_SALES_BLOCK,
  isWidgetClientRequest,
  appendWidgetSalesPrompt,
  assertWidgetDomainAllowed,
  getWidgetAllowedDomains,
  extractBrowserHost,
};
