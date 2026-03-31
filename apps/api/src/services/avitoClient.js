"use strict";

/**
 * avitoClient.js — Avito Messenger API client.
 *
 * Supports two modes:
 *   1. DB-based (SaaS): pass { token, accountId } explicitly via createClient()
 *   2. Env-based (legacy fallback): call sendMessage() / getChats() directly
 *
 * Avito Messenger API v1 docs:
 *   https://developers.avito.ru/api-catalog/messenger/documentation
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

    getChats: () => apiRequest(t, "GET", `/messenger/v1/accounts/${id}/chats`),

    getMessages: (chatId) =>
      apiRequest(t, "GET", `/messenger/v1/accounts/${id}/chats/${chatId}/messages`),

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

module.exports = { createClient, sendMessage, getChats, getMessages, markAsRead };
