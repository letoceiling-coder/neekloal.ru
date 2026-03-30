"use strict";

const prisma = require("../lib/prisma");
const { detectIntent } = require("./intentDetector");
const { routeKnowledgeByIntent } = require("./knowledgeRouter");
const { getAssistantConfig } = require("./configLoader");

const VALID_STAGES = new Set(["greeting", "qualification", "offer", "objection", "close"]);

/**
 * Maps FSM stage → intent label used for stage-based knowledge routing.
 * This is PRIORITY 0: the current stage always determines what knowledge to show,
 * regardless of what the user typed.
 */
const STAGE_TO_INTENT = {
  objection:     "objection",
  qualification: "qualification_site",
  offer:         "pricing",
  close:         "close",
};

/**
 * @param {string} current
 * @param {string} intent
 * @returns {string}
 */
function computeNextStage(current, intent) {
  const c = VALID_STAGES.has(current) ? current : "greeting";
  if (intent === "qualification_site") return "qualification";
  if (intent === "objection") return "objection";
  if (intent === "pricing") return "offer";
  if (intent === "close") return "close";
  return c;
}

/**
 * Intent → FSM stage (persist on conversation), knowledge via router или RAG/DB fallback.
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string} p.assistantId
 * @param {unknown} p.conversationId
 * @param {unknown} p.message
 * @param {string} p.ragBlock
 * @param {string} p.dbFallbackBlock
 * @param {{ config?: object|null } | null} [p.assistant]  Optional assistant record for config lookup
 * @returns {Promise<{ intent: string; stage: string; knowledgeSource: "intent"|"rag"; knowledgeBlock: string; context: object }>}
 */
async function applyHybridSalesPipeline(p) {
  // Load assistant config (falls back to defaultAssistantConfig if assistant.config is null)
  const assistantConfig = getAssistantConfig(p.assistant ?? {});
  const { intent } = detectIntent(p.message, assistantConfig);

  let stage = "greeting";
  /** @type {string|null} */
  let convId = null;
  let persistedStage = "greeting";
  /** @type {object} */
  let persistedContext = {};

  const cid =
    p.conversationId != null && String(p.conversationId).trim() !== ""
      ? String(p.conversationId).trim()
      : null;

  if (cid) {
    const conv = await prisma.conversation.findFirst({
      where: {
        id: cid,
        organizationId: p.organizationId,
        assistantId: p.assistantId,
        deletedAt: null,
      },
      select: { id: true, salesStage: true, context: true },
    });
    if (conv) {
      convId = conv.id;
      persistedStage = VALID_STAGES.has(conv.salesStage) ? conv.salesStage : "greeting";
      stage = persistedStage;
      if (conv.context && typeof conv.context === "object") {
        persistedContext = conv.context;
      }
    }
  }

  const nextStage = computeNextStage(stage, intent);

  if (convId && nextStage !== persistedStage) {
    await prisma.conversation.update({
      where: { id: convId },
      data: { salesStage: nextStage },
    });
  }

  stage = nextStage;

  // ─── Memory updates (conversation.context) ───────────────────────────────
  const t = String(p.message ?? "").toLowerCase();

  let budget = null;
  if (t.includes("бюджет")) {
    const m = t.match(/бюджет[^0-9]{0,30}([0-9][0-9\s]{2,})(?:\s*(?:руб|р\.|₽))?/i);
    if (m && m[1]) {
      const n = parseInt(String(m[1]).replace(/\s+/g, ""), 10);
      if (!Number.isNaN(n)) budget = n;
    }
  }

  let projectType = null;
  if (intent === "qualification_site" || t.includes("сайт") || t.includes("лендинг") || t.includes("интернет-магазин")) {
    if (t.includes("интернет-магазин") || t.includes("интернет магазин")) projectType = "ecommerce";
    else if (t.includes("лендинг")) projectType = "landing";
    else if (t.includes("сайт") || t.includes("проект") || t.includes("разработк")) projectType = "website";
  }

  const memoryContext = { ...(persistedContext || {}) };
  if (budget != null) memoryContext.budget = budget;
  if (projectType) memoryContext.projectType = projectType;

  if (convId && (budget != null || projectType)) {
    await prisma.conversation.update({
      where: { id: convId },
      data: { context: memoryContext },
    });
  }

  let knowledgeSource = "rag";
  let knowledgeBlock = "";
  let fsmKnowledgeFound = false;

  // ─── Priority 0: stage-based routing ─────────────────────────────────────
  // The CURRENT FSM stage determines the knowledge block regardless of intent.
  // If found → skip RAG entirely (caller reads fsmKnowledgeFound).
  const stageIntent = STAGE_TO_INTENT[stage];
  if (stageIntent) {
    const stageKnowledge = await routeKnowledgeByIntent(p.assistantId, p.organizationId, stageIntent);
    if (stageKnowledge && stageKnowledge.trim()) {
      knowledgeBlock = stageKnowledge.trim();
      knowledgeSource = "fsm";
      fsmKnowledgeFound = true;
    }
  }

  // ─── Priority 1: intent-based routing (only if stage had no knowledge) ────
  if (!fsmKnowledgeFound) {
    const routed = await routeKnowledgeByIntent(p.assistantId, p.organizationId, intent);
    if (routed && routed.trim()) {
      knowledgeBlock = routed.trim();
      knowledgeSource = "intent";
    } else {
      // ─── Priority 2: RAG / DB fallback ──────────────────────────────────
      const rag = String(p.ragBlock ?? "").trim();
      const db = String(p.dbFallbackBlock ?? "").trim();
      knowledgeBlock = rag || db;
      knowledgeSource = "rag";
    }
  }

  return { intent, stage, knowledgeSource, knowledgeBlock, fsmKnowledgeFound, context: memoryContext };
}

function isHybridSalesEnabled() {
  return process.env.HYBRID_SALES_AGENT !== "0";
}

module.exports = {
  applyHybridSalesPipeline,
  computeNextStage,
  isHybridSalesEnabled,
  VALID_STAGES,
};
