"use strict";

/**
 * avitoClient.js — Avito Messenger API client.
 *
 * Supports two modes:
 *   1. DB-based (SaaS): pass { token, accountId } explicitly via createClient()
 *   2. Env-based (legacy fallback): call sendMessage() / getChats() directly
 *
 * Документация Messenger API:
 *   https://developers.avito.ru/api-catalog/messenger/documentation
 *
 * Сверка с каталогом: чаты GET v2, сообщения GET v3, webhook POST v3, подписки POST v1,
 * отправка / read POST v1.
 */

const BASE_URL = "https://api.avito.ru";

// ── Internal request builder ──────────────────────────────────────────────────

/**
 * Perform an authenticated request to the Avito API.
 * @param {string}       token    Avito OAuth bearer token
 * @param {"GET"|"POST"} method
 * @param {string}       path     Path relative to BASE_URL
 * @param {object|null}  body     JSON body (for POST)
 * @returns {Promise<object>}
 */
async function apiRequest(token, method, path, body = null) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type":  "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[avitoClient] ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Включение webhook V3: POST /messenger/v3/webhook, тело только { url } (как в каталоге API).
 * Подпись входящих: webhookSecret в CRM должен совпадать с тем, что задано в настройках уведомлений Авито (если платформа его запрашивает отдельно).
 * @param {string} token Bearer access_token (scope messenger:read)
 * @param {{ url: string }} opts
 * @returns {Promise<{ status: number, data: unknown }>}
 */
async function registerMessengerV3Webhook(token, { url }) {
  const t = String(token ?? "").trim();
  const u = String(url ?? "").trim();
  if (!t) throw new Error("[avitoClient] token is required for webhook registration");
  if (!u) throw new Error("[avitoClient] webhook url is required");

  const body = { url: u };

  const res = await fetch(`${BASE_URL}/messenger/v3/webhook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${t}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text().catch(() => "");
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    throw new Error(`[avitoClient] POST /messenger/v3/webhook → ${res.status}: ${text.slice(0, 400)}`);
  }
  return { status: res.status, data };
}

/**
 * Список подписок webhook: официально POST /messenger/v1/subscriptions (не GET).
 * @param {string} token (scope messenger:read)
 * @returns {Promise<{ path: string, data: unknown }>}
 */
async function listMessengerWebhookSubscriptions(token) {
  const t = String(token ?? "").trim();
  if (!t) throw new Error("[avitoClient] token is required");

  const path = "/messenger/v1/subscriptions";
  const data = await apiRequest(t, "POST", path, {});
  return { path, data };
}

/**
 * Exchange app credentials for an OAuth access_token.
 * @param {{ clientId: string, clientSecret: string }} creds
 * @returns {Promise<{ accessToken: string, expiresIn: number, tokenType: string }>}
 */
async function getAppAccessToken({ clientId, clientSecret }) {
  const cid = String(clientId ?? "").trim();
  const csec = String(clientSecret ?? "").trim();
  if (!cid) throw new Error("[avitoClient] clientId is required");
  if (!csec) throw new Error("[avitoClient] clientSecret is required");

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", cid);
  body.set("client_secret", csec);

  const res = await fetch(`${BASE_URL}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[avitoClient] POST /token/ → ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const accessToken = String(data.access_token ?? "").trim();
  const expiresIn = Number(data.expires_in ?? 0);
  const tokenType = String(data.token_type ?? "");
  if (!accessToken) throw new Error("[avitoClient] /token/ response does not contain access_token");
  return { accessToken, expiresIn, tokenType };
}

/**
 * Resolve numeric Avito account ID using OAuth token.
 * @param {string} token
 * @returns {Promise<{ id: string, name: string | null, email: string | null }>}
 */
async function getSelfAccount(token) {
  const t = String(token ?? "").trim();
  if (!t) throw new Error("[avitoClient] token is required for /core/v1/accounts/self");

  const res = await fetch(`${BASE_URL}/core/v1/accounts/self`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${t}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[avitoClient] GET /core/v1/accounts/self → ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const id = String(data.id ?? "").trim();
  if (!id) throw new Error("[avitoClient] /core/v1/accounts/self does not return id");
  return {
    id,
    name: data.name ? String(data.name) : null,
    email: data.email ? String(data.email) : null,
  };
}

// ── Factory (DB-based / SaaS mode) ───────────────────────────────────────────

/**
 * Create a bound Avito client using explicit credentials.
 * Use this in the processor when agent has an AvitoAccount linked.
 *
 * @param {{ token: string, accountId: string }} creds
 * @returns {{ sendMessage, getChats, getMessages, markAsRead }}
 */
function createClient({ token, accountId }) {
  if (!token || !token.trim())     throw new Error("[avitoClient] token is required");
  if (!accountId || !String(accountId).trim()) throw new Error("[avitoClient] accountId is required");

  const t  = token.trim();
  const id = String(accountId).trim();

  return {
    sendMessage: async (chatId, text) => {
      const result = await apiRequest(
        t, "POST",
        `/messenger/v1/accounts/${id}/chats/${chatId}/messages`,
        { message: { text }, type: "text" }
      );
      process.stdout.write(`[avito:send] chatId=${chatId} chars=${text.length}\n`);
      return result;
    },

    getChats: () => apiRequest(t, "GET", `/messenger/v2/accounts/${id}/chats`),

    // Avito uses v3 endpoint for chat messages history.
    getMessages: (chatId) =>
      apiRequest(t, "GET", `/messenger/v3/accounts/${id}/chats/${chatId}/messages`),

    markAsRead: (chatId) =>
      apiRequest(t, "POST", `/messenger/v1/accounts/${id}/chats/${chatId}/read`),
  };
}

// ── Legacy env-based exports (backward compat) ────────────────────────────────

function _envToken() {
  const t = process.env.AVITO_TOKEN;
  if (!t || !t.trim()) throw new Error("[avitoClient] AVITO_TOKEN is not set");
  return t.trim();
}
function _envAccountId() {
  const id = process.env.AVITO_ACCOUNT_ID;
  if (!id || !String(id).trim()) throw new Error("[avitoClient] AVITO_ACCOUNT_ID is not set");
  return String(id).trim();
}

/** @deprecated Use createClient() for SaaS per-user accounts */
async function sendMessage(chatId, text) {
  return createClient({ token: _envToken(), accountId: _envAccountId() })
    .sendMessage(chatId, text);
}

/** @deprecated Use createClient() */
async function getChats() {
  return createClient({ token: _envToken(), accountId: _envAccountId() }).getChats();
}

/** @deprecated Use createClient() */
async function getMessages(chatId) {
  return createClient({ token: _envToken(), accountId: _envAccountId() }).getMessages(chatId);
}

/** @deprecated Use createClient() */
async function markAsRead(chatId) {
  return createClient({ token: _envToken(), accountId: _envAccountId() }).markAsRead(chatId);
}

module.exports = {
  createClient,
  sendMessage,
  getChats,
  getMessages,
  markAsRead,
  getAppAccessToken,
  getSelfAccount,
  registerMessengerV3Webhook,
  listMessengerWebhookSubscriptions,
};
