"use strict";

const prisma = require("../lib/prisma");
const { detectIntent } = require("./intentDetector");
const { routeKnowledgeByIntent } = require("./knowledgeRouter");

const VALID_STAGES = new Set(["greeting", "qualification", "offer", "objection", "close"]);

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
 * @returns {Promise<{ intent: string; stage: string; knowledgeSource: "intent"|"rag"; knowledgeBlock: string }>}
 */
async function applyHybridSalesPipeline(p) {
  const { intent } = detectIntent(p.message);

  let stage = "greeting";
  /** @type {string|null} */
  let convId = null;
  let persistedStage = "greeting";

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
      select: { id: true, salesStage: true },
    });
    if (conv) {
      convId = conv.id;
      persistedStage = VALID_STAGES.has(conv.salesStage) ? conv.salesStage : "greeting";
      stage = persistedStage;
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

  let knowledgeSource = "rag";
  let knowledgeBlock = "";

  const routed = await routeKnowledgeByIntent(p.assistantId, p.organizationId, intent);
  if (routed && routed.trim()) {
    knowledgeBlock = routed.trim();
    knowledgeSource = "intent";
  } else {
    const rag = String(p.ragBlock ?? "").trim();
    const db = String(p.dbFallbackBlock ?? "").trim();
    knowledgeBlock = rag || db;
    knowledgeSource = "rag";
  }

  return { intent, stage, knowledgeSource, knowledgeBlock };
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
