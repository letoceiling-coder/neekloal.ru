"use strict";

const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { retrieveForChat } = require("../services/rag");
const { runAgent } = require("../services/agent");
const { runAgentV2 } = require("../services/agentV2");
const { resolveModel, ensureModelAvailable } = require("../services/modelRouter");
const { finalizeChatUsage } = require("../services/planAccess");
const chatAuthMiddleware = require("../middleware/chatAuth");
const rateLimitMiddleware = require("../middleware/rateLimit");
const { widgetChatRateLimit } = require("../middleware/widgetRateLimit");
const {
  isWidgetClientRequest,
  appendWidgetSalesPrompt,
  assertWidgetDomainAllowed,
  WIDGET_SALES_BLOCK,
} = require("../services/widgetSales");
const { getLeadPhoneDigitsFromText, extractNameFromText } = require("../services/leadCapture");

const DEFAULT_AGENT_RULES_V1 =
  "You are an autonomous agent. Decide whether to call a tool or answer directly. " +
  "Respond ONLY with a single JSON object, no markdown.";
const DEFAULT_AGENT_RULES_V2 =
  "You are a multi-step agent. Use tools when needed, then respond with a final answer. Respond ONLY with one JSON object per turn.";

function estimateTokensFromMessage(message) {
  const text = message == null ? "" : String(message);
  return Math.round(text.length / 4);
}

/**
 * @param {object} payload
 * @param {boolean} isWidget
 * @param {{ userMessageId?: string|null, assistantMessageId?: string|null, lastCreatedAt?: Date|null }|undefined} persisted
 */
function withWidgetSync(payload, isWidget, persisted) {
  if (!isWidget || !persisted || !persisted.lastCreatedAt) {
    return payload;
  }
  return {
    ...payload,
    sync: {
      userMessageId: persisted.userMessageId,
      assistantMessageId: persisted.assistantMessageId,
      lastCreatedAt:
        persisted.lastCreatedAt instanceof Date
          ? persisted.lastCreatedAt.toISOString()
          : String(persisted.lastCreatedAt),
    },
  };
}

/**
 * Сохранить пару сообщений в беседу (виджет / CRM).
 * @param {object} p
 * @param {string} p.organizationId
 * @param {string|null|undefined} p.conversationId
 * @param {string} p.assistantId
 * @param {unknown} p.userText
 * @param {unknown} p.assistantText
 * @returns {Promise<{ userMessageId: string|null, assistantMessageId: string|null, lastCreatedAt: Date|null }|undefined>}
 */
async function persistChatTurn(p) {
  const { organizationId, conversationId, assistantId, userText, assistantText } = p;
  if (!conversationId || String(conversationId).trim() === "") {
    return undefined;
  }
  const conv = await prisma.conversation.findFirst({
    where: {
      id: String(conversationId),
      organizationId,
      assistantId,
      deletedAt: null,
    },
    select: { id: true, leadId: true },
  });
  if (!conv) {
    return undefined;
  }
  const u = String(userText ?? "");
  const a = String(assistantText ?? "");
  await prisma.message.createMany({
    data: [
      {
        organizationId,
        conversationId: conv.id,
        role: "user",
        content: u,
        tokens: estimateTokensFromMessage(u),
      },
      {
        organizationId,
        conversationId: conv.id,
        role: "assistant",
        content: a,
        tokens: estimateTokensFromMessage(a),
      },
    ],
  });
  /** @type {import('@prisma/client').Prisma.ConversationUpdateInput} */
  const convData = { status: "ACTIVE" };
  if (u.trim()) {
    convData.widgetSilenceFollowUpSentAt = null;
    convData.widgetFollowUpCount = 0;
  }
  await prisma.conversation.update({
    where: { id: conv.id },
    data: convData,
  });

  if (conv.leadId) {
    const leadRow = await prisma.lead.findFirst({
      where: { id: conv.leadId, organizationId, deletedAt: null },
    });
    if (leadRow) {
      /** @type {{ status?: import('@prisma/client').LeadPipelineStatus; firstMessage?: string; phone?: string; name?: string }} */
      const leadUpdate = {};
      if (leadRow.status === "NEW") {
        leadUpdate.status = "CONTACTED";
      }
      const fmEmpty =
        leadRow.firstMessage == null || String(leadRow.firstMessage).trim() === "";
      if (fmEmpty && u) {
        leadUpdate.firstMessage = u.slice(0, 20000);
      }
      const existingPhone = leadRow.phone != null ? String(leadRow.phone).trim() : "";
      const phoneEmpty = existingPhone === "";
      const phoneDigits = phoneEmpty ? getLeadPhoneDigitsFromText(u) : null;
      if (phoneDigits && phoneEmpty) {
        leadUpdate.phone = phoneDigits;
      }
      const nameHint = extractNameFromText(u);
      const defaultName = "Widget visitor";
      if (
        nameHint &&
        (leadRow.name === defaultName || String(leadRow.name).trim() === defaultName)
      ) {
        leadUpdate.name = nameHint.slice(0, 120);
      }
      if (Object.keys(leadUpdate).length > 0) {
        await prisma.lead.update({
          where: { id: leadRow.id },
          data: leadUpdate,
        });
      }
    }
  }

  const recent = await prisma.message.findMany({
    where: { conversationId: conv.id, organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: { id: true, role: true, createdAt: true },
  });
  const userRow = recent.find((m) => m.role === "user");
  const asstRow = recent.find((m) => m.role === "assistant");
  const lastCreatedAt = recent.length ? recent[0].createdAt : null;
  return {
    userMessageId: userRow?.id ?? null,
    assistantMessageId: asstRow?.id ?? null,
    lastCreatedAt,
  };
}

/** When finalizeChatUsage fails after LLM: soft UX (no usage increment occurred). */
function usageWarningFromError(errorMessage) {
  const e = String(errorMessage || "");
  if (e === "Monthly request limit exceeded" || e === "Monthly token limit exceeded") {
    return "limit_exceeded";
  }
  if (e === "Organization is blocked") return "organization_blocked";
  if (e === "Model not allowed for your plan") return "model_not_allowed";
  return "usage_denied";
}

function getGenerateUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  return `${base.replace(/\/$/, "")}/api/generate`;
}

/**
 * @param {string} systemPrompt
 * @param {string} knowledgeBlock raw joined knowledge (may be empty)
 * @param {unknown} message
 */
function buildStructuredPrompt(systemPrompt, knowledgeBlock, message) {
  const sys = String(systemPrompt ?? "").trim();
  const kb = knowledgeBlock ? String(knowledgeBlock).trim() : "";
  const userMsg = message == null ? "" : String(message).trim();

  if (kb) {
    const prompt = `SYSTEM:
${sys}

KNOWLEDGE:
${kb}

USER:
${userMsg}`;
    return prompt.trim();
  }

  const prompt = `SYSTEM:
${sys}

USER:
${userMsg}`;
  return prompt.trim();
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function chatRoutes(fastify) {
  fastify.post("/chat", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware, widgetChatRateLimit],
  }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const message = body.message;
    const assistantId = body.assistantId;

    if (assistantId == null || String(assistantId).trim() === "") {
      return reply.code(400).send({ error: "assistantId is required" });
    }

    if (request.userId == null) {
      return reply.code(403).send({ error: "No acting user for this organization" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: String(assistantId),
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const isWidget = isWidgetClientRequest(request);
    if (isWidget) {
      const domainCheck = assertWidgetDomainAllowed(assistant, request);
      if (!domainCheck.ok) {
        return reply.code(403).send({ error: domainCheck.error });
      }
    }

    const chatAssistant = Object.assign({}, assistant, {
      systemPrompt: isWidget
        ? appendWidgetSalesPrompt(assistant.systemPrompt)
        : assistant.systemPrompt,
    });

    const uid = request.userId;

    let model =
      assistant.model === "auto"
        ? resolveModel(message)
        : assistant.model;
    model = await ensureModelAvailable(model, process.env.OLLAMA_URL);
    console.log("MODEL SELECTED:", model);

    const estimatedInputTokens = estimateTokensFromMessage(message);

    let knowledgeBlock = "";

    if (qdrant.isRagEnabled()) {
      const retrieved = await retrieveForChat(fastify, assistant.id, message, 5);
      knowledgeBlock = retrieved.knowledgeBlock;
    }

    if (!knowledgeBlock.trim()) {
      const knowledgeRows = await prisma.knowledge.findMany({
        where: { assistantId: assistant.id, organizationId: assistant.organizationId },
        orderBy: { createdAt: "asc" },
        take: 3,
      });
      knowledgeBlock =
        knowledgeRows.length > 0 ? knowledgeRows.map((k) => k.content).join("\n\n") : "";
      if (knowledgeRows.length > 0 && qdrant.isRagEnabled()) {
        fastify.log.info(
          { assistantId: assistant.id, knowledgeDocumentsUsed: knowledgeRows.length },
          "chat knowledge: RAG empty, using raw knowledge document text fallback"
        );
      }
    }

    const agentRecord = await prisma.agent.findFirst({
      where: {
        organizationId: assistant.organizationId,
        assistantId: assistant.id,
        deletedAt: null,
      },
      include: { tools: true },
    });

    let agentForChat = agentRecord;
    if (agentRecord && isWidget) {
      const useV2Rules = String(agentRecord.mode || "v1").toLowerCase() === "v2";
      const fallbackRules = useV2Rules ? DEFAULT_AGENT_RULES_V2 : DEFAULT_AGENT_RULES_V1;
      const baseRules =
        agentRecord.rules && String(agentRecord.rules).trim() !== ""
          ? String(agentRecord.rules).trim()
          : fallbackRules;
      agentForChat = { ...agentRecord, rules: `${baseRules}${WIDGET_SALES_BLOCK}` };
    }

    try {
      if (agentForChat) {
        const useV2 = String(agentForChat.mode || "v1").toLowerCase() === "v2";
        const runner = useV2 ? runAgentV2 : runAgent;
        const { reply: replyText, model: modelOut } = await runner({
          assistant,
          message,
          knowledgeBlock,
          model,
          agent: agentForChat,
          initiatedByUserId: uid,
        });

        const usage = await finalizeChatUsage({
          organizationId: assistant.organizationId,
          userId: uid,
          apiKeyId: request.apiKeyId,
          assistantId: assistant.id,
          conversationId: body.conversationId != null ? String(body.conversationId) : null,
          model: modelOut,
          inputTokens: estimatedInputTokens,
          outputTokens: estimateTokensFromMessage(replyText),
        });
        if (!usage.ok) {
          const persisted = await persistChatTurn({
            organizationId: assistant.organizationId,
            conversationId: body.conversationId != null ? String(body.conversationId) : null,
            assistantId: assistant.id,
            userText: message,
            assistantText: replyText,
          });
          return withWidgetSync(
            {
              reply: replyText,
              model: modelOut,
              warning: usageWarningFromError(usage.error),
            },
            isWidget,
            persisted
          );
        }

        const persistedAgent = await persistChatTurn({
          organizationId: assistant.organizationId,
          conversationId: body.conversationId != null ? String(body.conversationId) : null,
          assistantId: assistant.id,
          userText: message,
          assistantText: replyText,
        });
        return withWidgetSync({ reply: replyText, model: modelOut }, isWidget, persistedAgent);
      }

      const prompt = buildStructuredPrompt(chatAssistant.systemPrompt, knowledgeBlock, message);
      fastify.log.info({ prompt }, "chat prompt");

      const url = getGenerateUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        fastify.log.error({ status: res.status, body: text }, "ollama generate failed");
        return reply.code(500).send({ error: "Ollama request failed" });
      }

      const data = await res.json();
      const replyText = data.response != null ? String(data.response) : "";

      const usage = await finalizeChatUsage({
        organizationId: assistant.organizationId,
        userId: uid,
        apiKeyId: request.apiKeyId,
        assistantId: assistant.id,
        conversationId: body.conversationId != null ? String(body.conversationId) : null,
        model,
        inputTokens: estimatedInputTokens,
        outputTokens: estimateTokensFromMessage(replyText),
      });
      if (!usage.ok) {
        const persisted = await persistChatTurn({
          organizationId: assistant.organizationId,
          conversationId: body.conversationId != null ? String(body.conversationId) : null,
          assistantId: assistant.id,
          userText: message,
          assistantText: replyText,
        });
        return withWidgetSync(
          {
            reply: replyText,
            model,
            warning: usageWarningFromError(usage.error),
          },
          isWidget,
          persisted
        );
      }

      const persistedOllama = await persistChatTurn({
        organizationId: assistant.organizationId,
        conversationId: body.conversationId != null ? String(body.conversationId) : null,
        assistantId: assistant.id,
        userText: message,
        assistantText: replyText,
      });
      return withWidgetSync({ reply: replyText, model }, isWidget, persistedOllama);
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message || "Internal Server Error" });
    }
  });
};
