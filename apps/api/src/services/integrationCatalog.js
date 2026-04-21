"use strict";

const prisma = require("../lib/prisma");

/** Curated Anthropic models (API has no stable public list for all accounts). */
const ANTHROPIC_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-haiku-20240307",
];

/** Fallback xAI ids if /v1/models is unavailable. */
const XAI_FALLBACK_MODELS = ["grok-3", "grok-3-mini", "grok-2-1212", "grok-2-vision-1212"];

/** Sample Replicate text models (full catalog is huge; extend as needed). */
const REPLICATE_MODELS = [
  "meta/meta-llama-3-70b-instruct",
  "meta/meta-llama-3-8b-instruct",
  "mistralai/mixtral-8x7b-instruct-v0.1",
];

const FETCH_TIMEOUT_MS = 12_000;

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchOpenAIModelNames(apiKey) {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI models ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const ids  = (data.data || []).map((m) => m.id).filter(Boolean);
  return ids.filter((id) => {
    const x = String(id).toLowerCase();
    if (x.includes("embedding")) return false;
    if (x.includes("moderation")) return false;
    if (x.startsWith("davinci") && x.includes("embedding")) return false;
    return true;
  });
}

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchGoogleModelNames(apiKey) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models" +
    `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini models ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const out    = [];
  for (const m of data.models || []) {
    const name = String(m.name || "");
    const methods = m.supportedGenerationMethods || [];
    if (!methods.includes("generateContent")) continue;
    const short = name.startsWith("models/") ? name.slice("models/".length) : name;
    if (short) out.push(short);
  }
  return out;
}

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchXaiModelNames(apiKey) {
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return XAI_FALLBACK_MODELS;
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).filter(Boolean);
    return ids.length ? ids : XAI_FALLBACK_MODELS;
  } catch {
    return XAI_FALLBACK_MODELS;
  }
}

/**
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
async function fetchElevenLabsModelIds(apiKey) {
  const res = await fetch("https://api.elevenlabs.io/v1/models", {
    headers: { "xi-api-key": apiKey },
    signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`ElevenLabs models ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((m) => m.model_id || m.name).filter(Boolean);
}

/**
 * Build merged catalog entries for one org (Ollama names are added separately by caller).
 * @param {string} organizationId
 * @returns {Promise<Array<{ name: string, provider: string, kind: string }>>}
 */
async function listCloudModelEntries(organizationId) {
  const rows = await prisma.organizationAiIntegration.findMany({
    where: { organizationId: String(organizationId), isEnabled: true },
  });
  const out = [];

  for (const row of rows) {
    const key = row.apiKey && String(row.apiKey).trim();
    if (!key) continue;
    const p = String(row.provider).toLowerCase();

    try {
      if (p === "openai") {
        const ids = await fetchOpenAIModelNames(key);
        for (const id of ids) out.push({ name: `openai/${id}`, provider: "openai", kind: "chat" });
      } else if (p === "google") {
        const ids = await fetchGoogleModelNames(key);
        for (const id of ids) out.push({ name: `google/${id}`, provider: "google", kind: "chat" });
      } else if (p === "xai") {
        const ids = await fetchXaiModelNames(key);
        for (const id of ids) out.push({ name: `xai/${id}`, provider: "xai", kind: "chat" });
      } else if (p === "anthropic") {
        for (const id of ANTHROPIC_MODELS) {
          out.push({ name: `anthropic/${id}`, provider: "anthropic", kind: "chat" });
        }
      } else if (p === "replicate") {
        for (const id of REPLICATE_MODELS) {
          out.push({ name: `replicate/${id}`, provider: "replicate", kind: "image_or_llm" });
        }
      } else if (p === "elevenlabs") {
        const ids = await fetchElevenLabsModelIds(key);
        for (const id of ids) {
          out.push({ name: `elevenlabs/${id}`, provider: "elevenlabs", kind: "tts" });
        }
      }
    } catch (err) {
      process.stderr.write(
        `[integrationCatalog] provider=${p} org=${organizationId} err=${err && err.message ? err.message : String(err)}\n`
      );
    }
  }

  // Dedupe by name
  const seen = new Set();
  return out.filter((e) => {
    if (seen.has(e.name)) return false;
    seen.add(e.name);
    return true;
  });
}

module.exports = {
  listCloudModelEntries,
  ANTHROPIC_MODELS,
};
