"use strict";

/**
 * agentRuntimeV2.js — DB-persisted, multi-session, streaming-capable agent runtime.
 *
 * Key differences from agentRuntime.js (V1):
 *  - Context stored in PostgreSQL (AgentConversation) — survives restarts
 *  - Supports multiple named sessions per agent/user
 *  - Streaming via async generator (streamAgentChat)
 *  - Per-request params: temperature, maxTokens, systemPrompt override
 */

const prisma        = require("../lib/prisma");
const { selectModel } = require("./modelRouter");

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOllamaChatUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");
  return `${base.replace(/\/$/, "")}/api/chat`;
}

function buildOllamaBody(model, messages, { temperature, maxTokens, stream = false }) {
  const body = { model, messages, stream };
  const opts = {};
  if (temperature != null) opts.temperature  = temperature;
  if (maxTokens   != null) opts.num_predict  = maxTokens;
  if (Object.keys(opts).length) body.options = opts;
  return body;
}

// ── Conversation CRUD ─────────────────────────────────────────────────────────

/**
 * Create a new blank conversation for an agent/user.
 */
async function createConversation(agentId, userId, organizationId, title = null) {
  const conv = await prisma.agentConversation.create({
    data: { agentId, userId, organizationId, title, messages: [] },
  });
  process.stdout.write(
    `[agent:v2] created conversation id=${conv.id} agentId=${agentId}\n`
  );
  return conv;
}

/**
 * Fetch a conversation (with auth guard).
 */
async function getConversation(conversationId, organizationId) {
  return prisma.agentConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
}

/**
 * List all conversations for an agent in an org (metadata only, no messages).
 */
async function listConversations(agentId, organizationId) {
  const rows = await prisma.agentConversation.findMany({
    where: { agentId, organizationId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id:            r.id,
    agentId:       r.agentId,
    title:         r.title,
    messageCount:  Array.isArray(r.messages) ? r.messages.length : 0,
    createdAt:     r.createdAt,
    updatedAt:     r.updatedAt,
  }));
}

/**
 * Append messages to a conversation (returns updated messages array).
 */
async function appendMessages(conversationId, newMessages) {
  const conv = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  const updated = [...(Array.isArray(conv.messages) ? conv.messages : []), ...newMessages];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data:  { messages: updated },
  });
  return updated;
}

/**
 * Clear all messages in a conversation.
 */
async function clearConversation(conversationId, organizationId) {
  await prisma.agentConversation.updateMany({
    where: { id: conversationId, organizationId },
    data:  { messages: [] },
  });
  process.stdout.write(`[agent:v2] cleared conversation id=${conversationId}\n`);
}

// ── Non-streaming chat (V2) ───────────────────────────────────────────────────

/**
 * Single-turn chat with DB persistence.
 *
 * @param {{
 *   conversationId: string,
 *   message:        string,
 *   organizationId: string,
 *   systemPrompt?:  string | null,
 *   model?:         string,
 *   temperature?:   number,
 *   maxTokens?:     number,
 * }} opts
 */
async function agentChatV2({ conversationId, message, organizationId, systemPrompt, model, temperature, maxTokens }) {
  const selectedModel = model || selectModel("chat");

  const conv = await prisma.agentConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  const history = Array.isArray(conv.messages) ? conv.messages : [];

  // Build messages for Ollama
  const fullMessages = [];
  if (systemPrompt && systemPrompt.trim()) {
    fullMessages.push({ role: "system", content: systemPrompt.trim() });
  }
  fullMessages.push(...history, { role: "user", content: message });

  process.stdout.write(
    `[agent:v2] chat conv=${conversationId} model=${selectedModel} ctx=${history.length}\n`
  );

  const ollamaRes = await fetch(getOllamaChatUrl(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(buildOllamaBody(selectedModel, fullMessages, { temperature, maxTokens, stream: false })),
  });

  if (!ollamaRes.ok) {
    const err = await ollamaRes.text();
    throw new Error(`Ollama /api/chat failed: ${ollamaRes.status} — ${err.slice(0, 300)}`);
  }

  const data    = await ollamaRes.json();
  const content = data.message?.content ?? "";
  const pTok    = Number(data.prompt_eval_count) || 0;
  const cTok    = Number(data.eval_count)         || 0;

  // Persist both turns
  const updatedMessages = [...history, { role: "user", content: message }, { role: "assistant", content }];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data:  { messages: updatedMessages },
  });

  process.stdout.write(
    `[agent:v2] tokens=${pTok}+${cTok} ctxLen=${updatedMessages.length}\n`
  );

  return {
    reply:         content,
    modelUsed:     selectedModel,
    tokens:        { prompt: pTok, completion: cTok, total: pTok + cTok },
    contextLength: updatedMessages.length,
    conversationId,
  };
}

// ── Streaming chat (V2) ───────────────────────────────────────────────────────

/**
 * Streaming chat with DB persistence.
 * Returns an async generator yielding:
 *   { token: string }                       — text chunk
 *   { done: true, modelUsed, tokens, ... }  — final event (after DB save)
 *
 * @param {{
 *   conversationId: string,
 *   message:        string,
 *   organizationId: string,
 *   systemPrompt?:  string | null,
 *   model?:         string,
 *   temperature?:   number,
 *   maxTokens?:     number,
 *   signal?:        AbortSignal,
 * }} opts
 */
async function* streamAgentChat({ conversationId, message, organizationId, systemPrompt, model, temperature, maxTokens, signal }) {
  const selectedModel = model || selectModel("chat");

  const conv = await prisma.agentConversation.findFirst({
    where: { id: conversationId, organizationId },
  });
  if (!conv) throw new Error(`Conversation ${conversationId} not found`);

  const history = Array.isArray(conv.messages) ? conv.messages : [];

  const fullMessages = [];
  if (systemPrompt && systemPrompt.trim()) {
    fullMessages.push({ role: "system", content: systemPrompt.trim() });
  }
  fullMessages.push(...history, { role: "user", content: message });

  process.stdout.write(
    `[agent:v2:stream] conv=${conversationId} model=${selectedModel} ctx=${history.length}\n`
  );

  const ollamaRes = await fetch(getOllamaChatUrl(), {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(buildOllamaBody(selectedModel, fullMessages, { temperature, maxTokens, stream: true })),
    signal,
  });

  if (!ollamaRes.ok) {
    const err = await ollamaRes.text();
    throw new Error(`Ollama stream failed: ${ollamaRes.status} — ${err.slice(0, 300)}`);
  }

  const reader  = ollamaRes.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";
  let   fullContent       = "";
  let   promptTokens      = 0;
  let   completionTokens  = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const token  = parsed.message?.content ?? "";
          if (token) {
            fullContent += token;
            yield { token };
          }
          if (parsed.done) {
            promptTokens     = Number(parsed.prompt_eval_count) || 0;
            completionTokens = Number(parsed.eval_count)         || 0;
          }
        } catch { /* skip malformed lines */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Persist both turns to DB
  const updatedMessages = [
    ...history,
    { role: "user",      content: message      },
    { role: "assistant", content: fullContent   },
  ];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data:  { messages: updatedMessages },
  });

  process.stdout.write(
    `[agent:v2:stream] done tokens=${promptTokens}+${completionTokens} ctxLen=${updatedMessages.length}\n`
  );

  yield {
    done:          true,
    modelUsed:     selectedModel,
    tokens:        { prompt: promptTokens, completion: completionTokens, total: promptTokens + completionTokens },
    contextLength: updatedMessages.length,
    conversationId,
  };
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  appendMessages,
  clearConversation,
  agentChatV2,
  streamAgentChat,
};
