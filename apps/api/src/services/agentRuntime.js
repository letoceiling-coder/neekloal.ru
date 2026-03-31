"use strict";

/**
 * agentRuntime.js — Playground chat runtime for agents.
 *
 * Uses Ollama /api/chat (multi-turn, messages array) for proper context
 * preservation across turns. Context lives in process memory (Map).
 *
 * Context key: "agentId:userId"
 * Context value: flattened user/assistant messages (excludes system prompt)
 */

const { selectModel } = require("./modelRouter");

// ── In-memory context store ───────────────────────────────────────────────────

const contextStore = new Map(); // key → [{ role, content }]

function makeKey(agentId, userId) {
  return `${agentId}:${userId}`;
}

// ── Ollama /api/chat helper ───────────────────────────────────────────────────

async function ollamaChat(model, messages) {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");

  const url = `${base.replace(/\/$/, "")}/api/chat`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model, messages, stream: false }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama /api/chat failed: ${res.status} — ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    content:          data.message?.content ?? "",
    promptTokens:     Number(data.prompt_eval_count) || 0,
    completionTokens: Number(data.eval_count)         || 0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run one chat turn in the agent playground.
 *
 * @param {{
 *   agentId:      string;
 *   userId:       string;
 *   systemPrompt: string | null;   // from agent.rules
 *   messages:     Array<{role:string; content:string}>;
 *   model?:       string;          // override; falls back to selectModel("chat")
 *   reset?:       boolean;         // clear context before this turn
 * }} opts
 * @returns {Promise<{ reply:string; modelUsed:string; tokens:{prompt,completion,total}; contextLength:number }>}
 */
async function agentChat({ agentId, userId, systemPrompt, messages, model, reset }) {
  const key          = makeKey(agentId, userId);
  const selectedModel = model || selectModel("chat");

  if (reset) {
    contextStore.delete(key);
    process.stdout.write(`[agentRuntime] context reset  key=${key}\n`);
  }

  const context = contextStore.get(key) ?? [];

  // Build full messages array: system → stored context → new messages
  const fullMessages = [];
  if (systemPrompt && systemPrompt.trim()) {
    fullMessages.push({ role: "system", content: systemPrompt.trim() });
  }
  fullMessages.push(...context, ...messages);

  process.stdout.write(
    `[agentRuntime] chat agentId=${agentId} model=${selectedModel} ` +
    `ctx=${context.length} new=${messages.length} total=${fullMessages.length}\n`
  );

  const { content, promptTokens, completionTokens } = await ollamaChat(selectedModel, fullMessages);

  // Persist updated context (user turns + assistant reply, no system prompt)
  const updatedContext = [...context, ...messages, { role: "assistant", content }];
  contextStore.set(key, updatedContext);

  process.stdout.write(
    `[agentRuntime] reply len=${content.length} tokens=${promptTokens}+${completionTokens} ctxLen=${updatedContext.length}\n`
  );

  return {
    reply:         content,
    modelUsed:     selectedModel,
    tokens: {
      prompt:      promptTokens,
      completion:  completionTokens,
      total:       promptTokens + completionTokens,
    },
    contextLength: updatedContext.length,
  };
}

/**
 * Clear stored context for agent/user pair.
 */
function clearContext(agentId, userId) {
  contextStore.delete(makeKey(agentId, userId));
}

/**
 * Current stored context length (for debug endpoints).
 */
function getContextLength(agentId, userId) {
  return contextStore.get(makeKey(agentId, userId))?.length ?? 0;
}

module.exports = { agentChat, clearContext, getContextLength };
