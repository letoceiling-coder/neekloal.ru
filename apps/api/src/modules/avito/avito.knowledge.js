"use strict";

/**
 * avito.knowledge.js — load Knowledge for an Avito AI turn.
 *
 * Strategy (first hit wins):
 *   1. RAG via Qdrant (retrieveForChat) — when RAG is enabled and assistantId present
 *   2. DB fallback — prisma.knowledge.findMany (first 20 rows, concatenated)
 *
 * Avito pipeline is a BullMQ worker, not a Fastify request — so we pass a
 * minimal log-stub to reuse the existing retrieveForChat() without touching it.
 */

const prisma = require("../../lib/prisma");
const { retrieveForChat } = require("../../services/rag");
const qdrant = require("../../lib/qdrant");

// ── Log stub compatible with fastify.log interface ───────────────────────────

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

const stdoutLog = {
  info:  (obj, msg) => process.stdout.write(`[avito:knowledge] ${msg || "info"} ${safeJson(obj)}\n`),
  warn:  (obj, msg) => process.stderr.write(`[avito:knowledge] ${msg || "warn"} ${safeJson(obj)}\n`),
  error: (obj, msg) => process.stderr.write(`[avito:knowledge] ${msg || "error"} ${safeJson(obj)}\n`),
  debug: () => {},
  trace: () => {},
};

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "[unserializable]";
  }
}

const KNOWLEDGE_DB_LIMIT = 20;
const KNOWLEDGE_CHARS_LIMIT = 6000;

function truncate(text, max) {
  if (!text) return "";
  const s = String(text);
  return s.length > max ? `${s.slice(0, max)}\n…(truncated)` : s;
}

/**
 * Load a knowledge block for an Avito AI turn.
 *
 * @param {object} p
 * @param {string | null | undefined} p.assistantId
 * @param {string} p.organizationId
 * @param {string} p.message   last user message (used as RAG query)
 * @param {boolean} [p.verbose=false]
 * @returns {Promise<{ knowledgeBlock: string, source: "rag" | "db" | "none" }>}
 */
async function loadAvitoKnowledgeBlock(p) {
  const assistantId    = p.assistantId && String(p.assistantId).trim() ? String(p.assistantId).trim() : null;
  const organizationId = String(p.organizationId);
  const message        = String(p.message || "").trim();
  const log            = p.verbose ? stdoutLog : silentLog;

  if (!assistantId) {
    return { knowledgeBlock: "", source: "none" };
  }

  if (message && qdrant.isRagEnabled()) {
    try {
      const { knowledgeBlock } = await retrieveForChat(
        { log },
        assistantId,
        message,
        5
      );
      if (knowledgeBlock && knowledgeBlock.trim()) {
        return {
          knowledgeBlock: truncate(knowledgeBlock.trim(), KNOWLEDGE_CHARS_LIMIT),
          source: "rag",
        };
      }
    } catch (err) {
      process.stderr.write(
        `[avito:knowledge] RAG error (non-fatal): ${err && err.message ? err.message : String(err)}\n`
      );
    }
  }

  const rows = await prisma.knowledge.findMany({
    where:    { assistantId, organizationId, deletedAt: null },
    orderBy:  { createdAt: "asc" },
    take:     KNOWLEDGE_DB_LIMIT,
    select:   { content: true },
  });

  if (rows.length === 0) {
    return { knowledgeBlock: "", source: "none" };
  }

  const joined = rows
    .map((r) => (r.content || "").trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    knowledgeBlock: truncate(joined, KNOWLEDGE_CHARS_LIMIT),
    source: "db",
  };
}

module.exports = { loadAvitoKnowledgeBlock };
