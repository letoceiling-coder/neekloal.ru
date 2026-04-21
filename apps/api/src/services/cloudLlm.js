"use strict";

const prisma = require("../lib/prisma");

/** @typedef {{ kind: "ollama", raw: string } | { kind: "cloud", provider: string, modelId: string }} ParsedModel */

const CHAT_PROVIDERS = new Set(["openai", "anthropic", "google", "xai"]);
const NON_CHAT_PREFIX = new Set(["replicate", "elevenlabs"]);

/**
 * @param {string} model
 * @returns {ParsedModel | { kind: "unsupported", provider: string, modelId: string, raw: string }}
 */
function parseModelRef(model) {
  const s = String(model ?? "").trim();
  if (!s) return { kind: "ollama", raw: s };
  const i = s.indexOf("/");
  if (i <= 0 || i === s.length - 1) return { kind: "ollama", raw: s };
  const provider = s.slice(0, i).trim().toLowerCase();
  const modelId  = s.slice(i + 1).trim();
  if (CHAT_PROVIDERS.has(provider)) return { kind: "cloud", provider, modelId };
  if (NON_CHAT_PREFIX.has(provider)) {
    return { kind: "unsupported", provider, modelId, raw: s };
  }
  return { kind: "ollama", raw: s };
}

/**
 * @param {string} organizationId
 * @param {string} provider
 * @returns {Promise<string|null>}
 */
async function loadOrgApiKey(organizationId, provider) {
  const row = await prisma.organizationAiIntegration.findUnique({
    where: {
      organizationId_provider: {
        organizationId: String(organizationId),
        provider:       String(provider).toLowerCase(),
      },
    },
  });
  if (!row || !row.isEnabled) return null;
  const k = row.apiKey && String(row.apiKey).trim();
  return k || null;
}

/**
 * Split Ollama-style messages into system string + user/assistant history.
 * @param {Array<{role: string, content: string}>} fullMessages
 * @param {string|null|undefined} systemPrompt
 */
function splitSystemAndChat(fullMessages, systemPrompt) {
  let system = systemPrompt && String(systemPrompt).trim() ? String(systemPrompt).trim() : "";
  const chat = [];
  for (const m of fullMessages) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role || "").toLowerCase();
    const content = String(m.content ?? "");
    if (role === "system") {
      system = system ? `${system}\n\n${content}` : content;
    } else if (role === "user" || role === "assistant") {
      chat.push({ role, content });
    }
  }
  return { system: system.trim(), chat };
}

/**
 * @param {string} provider
 * @param {string} modelId
 * @param {string} apiKey
 * @param {{ system: string, chat: Array<{role: string, content: string}> }} msgs
 * @param {{ temperature?: number, maxTokens?: number }} opts
 */
async function runCloudCompletion(organizationId, provider, modelId, apiKey, msgs, opts) {
  const temperature = opts.temperature;
  const maxTokens   = opts.maxTokens;

  if (provider === "openai") {
    const body = {
      model:       modelId,
      messages:  msgs.system
        ? [{ role: "system", content: msgs.system }, ...msgs.chat]
        : msgs.chat,
      temperature: temperature != null ? temperature : 0.7,
    };
    if (maxTokens != null && Number.isFinite(maxTokens)) body.max_tokens = Math.floor(maxTokens);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 400)}`);
    const data = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content ?? "";
    const u    = data.usage || {};
    const pTok = Number(u.prompt_tokens) || 0;
    const cTok = Number(u.completion_tokens) || 0;
    return { content: text, promptTokens: pTok, completionTokens: cTok, modelUsed: `${provider}/${modelId}` };
  }

  if (provider === "xai") {
    const body = {
      model:       modelId,
      messages:  msgs.system
        ? [{ role: "system", content: msgs.system }, ...msgs.chat]
        : msgs.chat,
      temperature: temperature != null ? temperature : 0.7,
    };
    if (maxTokens != null && Number.isFinite(maxTokens)) body.max_tokens = Math.floor(maxTokens);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`xAI ${res.status}: ${raw.slice(0, 400)}`);
    const data = JSON.parse(raw);
    const text = data.choices?.[0]?.message?.content ?? "";
    const u    = data.usage || {};
    const pTok = Number(u.prompt_tokens) || 0;
    const cTok = Number(u.completion_tokens) || 0;
    return { content: text, promptTokens: pTok, completionTokens: cTok, modelUsed: `${provider}/${modelId}` };
  }

  if (provider === "anthropic") {
    const anthropicMessages = msgs.chat.map((m) => ({
      role:    m.role === "assistant" ? "assistant" : "user",
      content: [{ type: "text", text: m.content }],
    }));
    const body = {
      model:       modelId,
      max_tokens:  maxTokens != null && Number.isFinite(maxTokens) ? Math.min(8192, Math.floor(maxTokens)) : 2048,
      messages:    anthropicMessages,
      temperature: temperature != null ? temperature : 0.7,
    };
    if (msgs.system) body.system = msgs.system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${raw.slice(0, 400)}`);
    const data = JSON.parse(raw);
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("") || "";
    const u    = data.usage || {};
    const pTok = Number(u.input_tokens) || 0;
    const cTok = Number(u.output_tokens) || 0;
    return { content: text, promptTokens: pTok, completionTokens: cTok, modelUsed: `${provider}/${modelId}` };
  }

  if (provider === "google") {
    const contents = [];
    for (const m of msgs.chat) {
      contents.push({
        role:  m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }
    const body = { contents };
    if (msgs.system) {
      body.systemInstruction = { parts: [{ text: msgs.system }] };
    }
    const genConfig = {};
    if (temperature != null && Number.isFinite(temperature)) genConfig.temperature = temperature;
    if (maxTokens != null && Number.isFinite(maxTokens)) genConfig.maxOutputTokens = Math.floor(maxTokens);
    if (Object.keys(genConfig).length) body.generationConfig = genConfig;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${raw.slice(0, 400)}`);
    const data = JSON.parse(raw);
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text  = parts.map((p) => p.text || "").join("");
    const u     = data.usageMetadata || {};
    const pTok  = Number(u.promptTokenCount) || 0;
    const cTok  = Number(u.candidatesTokenCount) || 0;
    return { content: text, promptTokens: pTok, completionTokens: cTok, modelUsed: `${provider}/${modelId}` };
  }

  throw new Error(`Unsupported cloud provider: ${provider}`);
}

module.exports = {
  parseModelRef,
  loadOrgApiKey,
  runCloudCompletion,
  splitSystemAndChat,
  CHAT_PROVIDERS,
};
