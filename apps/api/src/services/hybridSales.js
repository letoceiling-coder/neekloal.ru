"use strict";

const prisma = require("../lib/prisma");
const { detectIntent } = require("./intentDetector");
const { routeKnowledgeByIntent } = require("./knowledgeRouter");
const { getAssistantConfig } = require("./configLoader");
const { extractMemory } = require("./memoryExtractor");

// ─── Built-in FSM defaults (used as fallback when config is absent) ──────────
const VALID_STAGES = new Set(["greeting", "qualification", "offer", "objection", "close"]);

/** Maps FSM stage → intent for stage-based knowledge routing (Priority 0). */
const STAGE_TO_INTENT = {
  objection:     "objection",
  qualification: "qualification_site",
  offer:         "pricing",
  close:         "close",
};

/**
 * Intent-driven stage transition — original logic, kept as fallback.
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
 * Config-driven sequential stage advancement through config.funnel.
 * Used when assistant.config.funnel is present.
 * Falls back to computeNextStage when config.funnel is absent.
 *
 * @param {string} currentStage
 * @param {string} intent         — still used if config.funnel is absent
 * @param {{ funnel?: string[] } | null} config
 * @returns {string}
 */
function getNextStage(currentStage, intent, config) {
  const funnel = Array.isArray(config?.funnel) && config.funnel.length > 0
    ? config.funnel
    : null;

  if (!funnel) {
    // Fallback: original intent-driven logic
    return computeNextStage(currentStage, intent);
  }

  const index = funnel.indexOf(currentStage);
  if (index === -1) return funnel[0];                       // unknown stage → start
  if (index + 1 >= funnel.length) return currentStage;     // already at end → stay
  return funnel[index + 1];                                 // advance one step
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

  // Build config-aware valid-stage set and stage→intent map
  const validStagesSet = Array.isArray(assistantConfig.funnel) && assistantConfig.funnel.length > 0
    ? new Set(assistantConfig.funnel)
    : VALID_STAGES;

  const stageIntentMap =
    assistantConfig.stageIntents && typeof assistantConfig.stageIntents === "object"
      ? assistantConfig.stageIntents
      : STAGE_TO_INTENT;

  const defaultStage = (assistantConfig.funnel?.[0]) ?? "greeting";

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
      persistedStage = validStagesSet.has(conv.salesStage) ? conv.salesStage : defaultStage;
      stage = persistedStage;
      if (conv.context && typeof conv.context === "object") {
        persistedContext = conv.context;
      }
    }
  }

  const nextStage = getNextStage(stage, intent, assistantConfig);

  stage = nextStage;

  // ─── Memory updates (conversation.context) ───────────────────────────────
  const newMemory = extractMemory(p.message, intent, assistantConfig);
  const memoryContext = { ...(persistedContext || {}), ...newMemory };

  // Single Prisma update merging both stage and context changes
  if (convId) {
    const stageChanged = nextStage !== persistedStage;
    const memoryChanged = Object.keys(newMemory).length > 0;
    if (stageChanged || memoryChanged) {
      const data = {};
      if (stageChanged) data.salesStage = nextStage;
      if (memoryChanged) data.context = memoryContext;
      await prisma.conversation.update({ where: { id: convId }, data });
    }
  }

  let knowledgeSource = "rag";
  let knowledgeBlock = "";
  let fsmKnowledgeFound = false;

  // ─── Priority 0: stage-based routing ─────────────────────────────────────
  // The CURRENT FSM stage determines the knowledge block regardless of intent.
  // If found → skip RAG entirely (caller reads fsmKnowledgeFound).
  const stageIntent = stageIntentMap[stage];
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
  getNextStage,
  isHybridSalesEnabled,
  VALID_STAGES,
  STAGE_TO_INTENT,
};
