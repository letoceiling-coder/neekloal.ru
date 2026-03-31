"use strict";

/**
 * avitoClient.js — Avito Messenger API client.
 *
 * Configuration via .env:
 *   AVITO_TOKEN       — OAuth access token (Bearer)
 *   AVITO_ACCOUNT_ID  — Numeric Avito account / user ID
 *
 * Avito Messenger API v1 docs:
 *   https://developers.avito.ru/api-catalog/messenger/documentation
 */

const BASE_URL = "https://api.avito.ru";

function getToken() {
  const t = process.env.AVITO_TOKEN;
  if (!t || !t.trim()) throw new Error("[avitoClient] AVITO_TOKEN is not set");
  return t.trim();
}

function getAccountId() {
  const id = process.env.AVITO_ACCOUNT_ID;
  if (!id || !String(id).trim()) throw new Error("[avitoClient] AVITO_ACCOUNT_ID is not set");
  return String(id).trim();
}

/**
 * Perform an authenticated request to the Avito API.
 * @param {"GET"|"POST"} method
 * @param {string}       path    Path relative to BASE_URL
 * @param {object|null}  body    JSON body (for POST)
 * @returns {Promise<object>}
 */
async function apiRequest(method, path, body = null) {
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${getToken()}`,
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a text message to an Avito chat.
 * @param {string} chatId   Avito chat_id
 * @param {string} text     Message text (max ~4096 chars per Avito limits)
 * @returns {Promise<object>}
 */
async function sendMessage(chatId, text) {
  const accountId = getAccountId();
  const result    = await apiRequest(
    "POST",
    `/messenger/v1/accounts/${accountId}/chats/${chatId}/messages`,
    { message: { text }, type: "text" }
  );
  process.stdout.write(`[avito:send] chatId=${chatId} chars=${text.length}\n`);
  return result;
}

/**
 * List all chats for the configured Avito account.
 * @returns {Promise<object>}
 */
async function getChats() {
  const accountId = getAccountId();
  return apiRequest("GET", `/messenger/v1/accounts/${accountId}/chats`);
}

/**
 * List messages in a specific chat.
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function getMessages(chatId) {
  const accountId = getAccountId();
  return apiRequest("GET", `/messenger/v1/accounts/${accountId}/chats/${chatId}/messages`);
}

/**
 * Mark messages in a chat as read.
 * @param {string} chatId
 * @returns {Promise<object>}
 */
async function markAsRead(chatId) {
  const accountId = getAccountId();
  return apiRequest(
    "POST",
    `/messenger/v1/accounts/${accountId}/chats/${chatId}/read`
  );
}

module.exports = { sendMessage, getChats, getMessages, markAsRead };
