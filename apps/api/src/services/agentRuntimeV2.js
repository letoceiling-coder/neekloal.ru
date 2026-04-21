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
const { finalizeChatUsage, preCheckChatBeforeLlm } = require("./planAccess");
const {
  parseModelRef,
  loadOrgApiKey,
  runCloudCompletion,
  splitSystemAndChat,
} = require("./cloudLlm");

// ── Helpers ───────────────────────────────────────────────────────────────────

function roughTokenEstimate(text) {
  const s = text == null ? "" : String(text);
  return Math.max(1, Math.round(s.length / 4));
}

/**
 * @param {string} organizationId
 * @param {{ id: string, agentId: string, userId: string }} conv
 * @param {string} modelUsed
 * @param {number} pTok
 * @param {number} cTok
 */
async function recordAgentChatUsage(organizationId, conv, modelUsed, pTok, cTok) {
  let assistantId = null;
  try {
    const ag = await prisma.agent.findFirst({
      where: { id: conv.agentId },
      select: { assistantId: true },
    });
    assistantId = ag?.assistantId ?? null;
  } catch { /* non-fatal */ }

  const fin = await finalizeChatUsage({
    organizationId,
    // AgentConversation.userId is not guaranteed to reference users.id
    // (e.g. external channels may store agentId as placeholder), so keep null.
    userId:         null,
    apiKeyId:       null,
    assistantId,
    // Usage.conversationId references Conversation (web chat), not AgentConversation.
    // For agent runtime we still meter tokens, but do not bind FK to Conversation.
    conversationId: null,
    model:          modelUsed,
    inputTokens:    pTok,
    outputTokens:   cTok,
  });
  if (!fin.ok) {
    process.stderr.write(
      `[agent:v2] finalizeChatUsage failed org=${organizationId} model=${modelUsed}: ${fin.error}\n`
    );
  }
}

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

  // Build messages for LLM (Ollama or cloud)
  const fullMessages = [];
  if (systemPrompt && systemPrompt.trim()) {
    fullMessages.push({ role: "system", content: systemPrompt.trim() });
  }
  fullMessages.push(...history, { role: "user", content: message });

  const parsed = parseModelRef(selectedModel);
  if (parsed.kind === "unsupported") {
    throw new Error(
      `Модель «${parsed.raw}» не используется в текстовом чате агентов. ` +
        "Выберите openai/…, anthropic/…, google/…, xai/… или локальную модель Ollama."
    );
  }
  const billingModel =
    parsed.kind === "cloud" ? `${parsed.provider}/${parsed.modelId}` : selectedModel;

  const estIn  = roughTokenEstimate(JSON.stringify(fullMessages));
  const estOut = 512;
  const pre = await preCheckChatBeforeLlm({
    organizationId,
    modelName:               billingModel,
    estimatedInputTokens:    estIn,
    estimatedOutputTokens:   estOut,
  });
  if (!pre.ok) {
    throw new Error(pre.error || "Usage pre-check failed");
  }

  process.stdout.write(
    `[agent:v2] chat conv=${conversationId} model=${selectedModel} ctx=${history.length} route=${parsed.kind}\n`
  );

  let content;
  let pTok;
  let cTok;
  let modelUsed;

  if (parsed.kind === "cloud") {
    const apiKey = await loadOrgApiKey(organizationId, parsed.provider);
    if (!apiKey) {
      throw new Error(
        `Провайдер ${parsed.provider}: API ключ не задан или интеграция выключена. Настройте в разделе «Интеграции AI».`
      );
    }
    const msgs = splitSystemAndChat(fullMessages, systemPrompt);
    const r = await runCloudCompletion(
      organizationId,
      parsed.provider,
      parsed.modelId,
      apiKey,
      msgs,
      { temperature, maxTokens }
    );
    content   = r.content;
    pTok      = r.promptTokens;
    cTok      = r.completionTokens;
    modelUsed = r.modelUsed;
  } else {
    const ollamaRes = await fetch(getOllamaChatUrl(), {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(buildOllamaBody(selectedModel, fullMessages, { temperature, maxTokens, stream: false })),
    });

    if (!ollamaRes.ok) {
      const err = await ollamaRes.text();
      throw new Error(`Ollama /api/chat failed: ${ollamaRes.status} — ${err.slice(0, 300)}`);
    }

    const data = await ollamaRes.json();
    content   = data.message?.content ?? "";
    pTok      = Number(data.prompt_eval_count) || 0;
    cTok      = Number(data.eval_count)         || 0;
    modelUsed = selectedModel;
  }

  // Persist both turns
  const updatedMessages = [...history, { role: "user", content: message }, { role: "assistant", content }];
  await prisma.agentConversation.update({
    where: { id: conversationId },
    data:  { messages: updatedMessages },
  });

  await recordAgentChatUsage(organizationId, conv, modelUsed, pTok, cTok);

  process.stdout.write(
    `[agent:v2] tokens=${pTok}+${cTok} ctxLen=${updatedMessages.length}\n`
  );

  return {
    reply:         content,
    modelUsed,
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

  const parsed = parseModelRef(selectedModel);
  if (parsed.kind === "unsupported") {
    throw new Error(
      `Модель «${parsed.raw}» не используется в текстовом чате агентов. ` +
        "Выберите openai/…, anthropic/…, google/…, xai/… или локальную модель Ollama."
    );
  }
  const billingModel =
    parsed.kind === "cloud" ? `${parsed.provider}/${parsed.modelId}` : selectedModel;

  const estIn  = roughTokenEstimate(JSON.stringify(fullMessages));
  const estOut = 512;
  const pre = await preCheckChatBeforeLlm({
    organizationId,
    modelName:               billingModel,
    estimatedInputTokens:    estIn,
    estimatedOutputTokens:   estOut,
  });
  if (!pre.ok) {
    throw new Error(pre.error || "Usage pre-check failed");
  }

  process.stdout.write(
    `[agent:v2:stream] conv=${conversationId} model=${selectedModel} ctx=${history.length} route=${parsed.kind}\n`
  );

  // ── Cloud: non-streaming upstream, chunked SSE to client ───────────────────
  if (parsed.kind === "cloud") {
    const apiKey = await loadOrgApiKey(organizationId, parsed.provider);
    if (!apiKey) {
      throw new Error(
        `Провайдер ${parsed.provider}: API ключ не задан или интеграция выключена. Настройте в разделе «Интеграции AI».`
      );
    }
    const msgs = splitSystemAndChat(fullMessages, systemPrompt);
    const r = await runCloudCompletion(
      organizationId,
      parsed.provider,
      parsed.modelId,
      apiKey,
      msgs,
      { temperature, maxTokens }
    );
    const fullContent = r.content || "";
    const chunkSize  = 64;
    for (let i = 0; i < fullContent.length; i += chunkSize) {
      if (signal?.aborted) throw new Error("aborted");
      yield { token: fullContent.slice(i, i + chunkSize) };
    }

    const updatedMessages = [
      ...history,
      { role: "user",      content: message    },
      { role: "assistant", content: fullContent },
    ];
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data:  { messages: updatedMessages },
    });

    await recordAgentChatUsage(organizationId, conv, r.modelUsed, r.promptTokens, r.completionTokens);

    process.stdout.write(
      `[agent:v2:stream] cloud done tokens=${r.promptTokens}+${r.completionTokens} ctxLen=${updatedMessages.length}\n`
    );

    yield {
      done:          true,
      modelUsed:     r.modelUsed,
      tokens:        {
        prompt:     r.promptTokens,
        completion: r.completionTokens,
        total:      r.promptTokens + r.completionTokens,
      },
      contextLength: updatedMessages.length,
      conversationId,
    };
    return;
  }

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

  await recordAgentChatUsage(organizationId, conv, selectedModel, promptTokens, completionTokens);

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

// ── Avito / external channel helpers ─────────────────────────────────────────

/**
 * Find-or-create an AgentConversation for an external channel (e.g. Avito).
 * Uses (source + externalId + agentId) as the unique key.
 *
 * @param {string} agentId
 * @param {string} organizationId
 * @param {string} chatId          External chat identifier (Avito chat_id)
 * @param {string} externalUserId  External sender ID  (Avito author_id)
 * @param {string} [source="avito"]
 * @returns {Promise<object>}      AgentConversation row
 */
async function findOrCreateExternalConversation(agentId, organizationId, chatId, externalUserId, source = "avito") {
  const existing = await prisma.agentConversation.findFirst({
    where: { agentId, source, externalId: chatId },
  });
  if (existing) return existing;

  const conv = await prisma.agentConversation.create({
    data: {
      agentId,
      // Use agentId as placeholder userId — external chats have no platform user
      userId:         agentId,
      organizationId,
      source,
      externalId:     chatId,
      externalUserId,
      title:          `${source.toUpperCase()}: ${chatId}`,
      messages:       [],
    },
  });
  process.stdout.write(
    `[${source}:conv] created id=${conv.id} chatId=${chatId} agentId=${agentId}\n`
  );
  return conv;
}

module.exports = {
  createConversation,
  getConversation,
  listConversations,
  appendMessages,
  clearConversation,
  agentChatV2,
  streamAgentChat,
  findOrCreateExternalConversation,
};
