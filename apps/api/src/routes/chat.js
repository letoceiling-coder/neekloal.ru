"use strict";

const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { retrieveForChat } = require("../services/rag");
const { runAgent } = require("../services/agent");
const { runAgentV2 } = require("../services/agentV2");
const { resolveModel, ensureModelAvailable } = require("../services/modelRouter");
const { finalizeChatUsage, preCheckChatBeforeLlm } = require("../services/planAccess");
const { buildFinalPrompt } = require("../services/chatPrompt");
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
 * @param {import('fastify').FastifyInstance} fastify
 */
/**
 * Shared pre-LLM setup: auth is already done; returns everything needed to
 * call the LLM or agent, or sends an error response and returns null.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @param {import('fastify').FastifyInstance} fastify
 */
async function prepareChatContext(request, reply, fastify) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const message = body.message;
  const assistantId =
    body.assistantId != null && String(body.assistantId).trim() !== ""
      ? String(body.assistantId).trim()
      : request.assistantId || null;

  if (!assistantId) {
    reply.code(400).send({ error: "assistantId is required" });
    return null;
  }
  if (request.userId == null) {
    reply.code(403).send({ error: "No acting user for this organization" });
    return null;
  }

  const assistant = await prisma.assistant.findFirst({
    where: { id: assistantId, organizationId: request.organizationId, deletedAt: null },
  });
  if (!assistant) {
    reply.code(404).send({ error: "Assistant not found" });
    return null;
  }

  const isWidget = isWidgetClientRequest(request);
  if (isWidget) {
    const domainCheck = assertWidgetDomainAllowed(assistant, request);
    if (!domainCheck.ok) {
      reply.code(403).send({ error: domainCheck.error });
      return null;
    }
  }

  const chatAssistant = Object.assign({}, assistant, {
    systemPrompt: isWidget
      ? appendWidgetSalesPrompt(assistant.systemPrompt)
      : assistant.systemPrompt,
  });

  let model =
    assistant.model === "auto" ? resolveModel(message) : assistant.model;
  model = await ensureModelAvailable(model, process.env.OLLAMA_URL);
  console.log("MODEL SELECTED:", model);

  const estimatedInputTokens = estimateTokensFromMessage(message);
  const estimatedOutputTokens = Math.max(256, estimatedInputTokens * 2);

  const pre = await preCheckChatBeforeLlm({
    organizationId: assistant.organizationId,
    modelName: model,
    estimatedInputTokens,
    estimatedOutputTokens,
  });
  if (!pre.ok) {
    reply.code(pre.status).send({ error: pre.error });
    return null;
  }

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

  return {
    body,
    message,
    assistant,
    chatAssistant,
    isWidget,
    model,
    estimatedInputTokens,
    knowledgeBlock,
    agentForChat,
    uid: request.userId,
  };
}

module.exports = async function chatRoutes(fastify) {
  fastify.post("/chat", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware, widgetChatRateLimit],
  }, async (request, reply) => {
    const ctx = await prepareChatContext(request, reply, fastify);
    if (!ctx) return; // error already sent

    const { body, message, assistant, chatAssistant, isWidget, model,
            estimatedInputTokens, knowledgeBlock, agentForChat, uid } = ctx;

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

      const prompt = buildFinalPrompt({
        assistant: chatAssistant,
        systemPrompt: chatAssistant.systemPrompt,
        agent: null,
        knowledge: knowledgeBlock,
        message,
      });
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

  // ─── SSE streaming endpoint ───────────────────────────────────────────────
  const STREAM_TIMEOUT_MS = 30_000;
  const STREAM_MAX_TOKENS = 2_000; // ~8 000 chars; hard cap to protect server

  fastify.post("/chat/stream", {
    preHandler: [chatAuthMiddleware, rateLimitMiddleware, widgetChatRateLimit],
  }, async (request, reply) => {
    const ctx = await prepareChatContext(request, reply, fastify);
    if (!ctx) return; // error already sent

    const { body, message, assistant, chatAssistant, isWidget, model,
            estimatedInputTokens, knowledgeBlock, agentForChat, uid } = ctx;

    // Take over the raw socket — Fastify must not touch the response after this.
    reply.hijack();
    const raw = reply.raw;

    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": request.headers.origin || "*",
    });

    /** Send one SSE event (safe: no-op after end) */
    function send(event, data) {
      if (!streamEnded) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    let streamEnded = false;
    const ollamaController = new AbortController();

    // Hard timeout — close stream after 30 s regardless
    const timeoutId = setTimeout(() => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaController.abort();
        try { raw.write(`event: error\ndata: ${JSON.stringify({ error: "Stream timeout (30s)" })}\n\n`); } catch { /* */ }
        raw.end();
      }
    }, STREAM_TIMEOUT_MS);

    // Abort when client closes the connection early
    request.raw.on("close", () => {
      if (!streamEnded) {
        streamEnded = true;
        ollamaController.abort();
        clearTimeout(timeoutId);
      }
    });

    try {
      let fullText = "";
      let streamedTokens = 0;

      if (agentForChat) {
        // Agent: run synchronously (no per-token streaming), then emit whole reply
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
        fullText = replyText;
        // Emit word by word to simulate streaming UX
        const words = fullText.split(/(\s+)/);
        for (const w of words) {
          if (streamEnded) break;
          if (w) {
            send("token", { token: w });
            streamedTokens += Math.round(w.length / 4);
            if (streamedTokens >= STREAM_MAX_TOKENS) break;
          }
        }
      } else {
        // Direct Ollama — real token streaming
        const prompt = buildFinalPrompt({
          assistant: chatAssistant,
          systemPrompt: chatAssistant.systemPrompt,
          agent: null,
          knowledge: knowledgeBlock,
          message,
        });
        fastify.log.info({ prompt }, "chat/stream prompt");

        const ollamaUrl = getGenerateUrl();
        const ollamaRes = await fetch(ollamaUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, stream: true }),
          signal: ollamaController.signal,
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          const errText = await ollamaRes.text().catch(() => "");
          fastify.log.error({ status: ollamaRes.status, body: errText }, "ollama stream failed");
          send("error", { error: "Ollama stream failed" });
          streamEnded = true;
          raw.end();
          clearTimeout(timeoutId);
          return;
        }

        // Read NDJSON stream line by line
        const decoder = new TextDecoder();
        let buf = "";
        outer: for await (const chunk of ollamaRes.body) {
          if (streamEnded) break;
          buf += decoder.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (streamEnded) break outer;
            const l = line.trim();
            if (!l) continue;
            try {
              const obj = JSON.parse(l);
              if (obj.response) {
                fullText += obj.response;
                send("token", { token: obj.response });
                streamedTokens += Math.round(obj.response.length / 4);
                if (streamedTokens >= STREAM_MAX_TOKENS) {
                  // Cap reached — stop, do not error
                  send("done", { model, truncated: true });
                  streamEnded = true;
                  ollamaController.abort();
                  break outer;
                }
              }
            } catch { /* ignore malformed line */ }
          }
        }
        // flush tail (only if not aborted)
        if (!streamEnded && buf.trim()) {
          try {
            const obj = JSON.parse(buf.trim());
            if (obj.response) {
              fullText += obj.response;
              send("token", { token: obj.response });
            }
          } catch { /* */ }
        }
      }

      // Finalize usage + persist (skip if aborted before we got any text)
      if (!streamEnded || fullText.length > 0) {
        await finalizeChatUsage({
          organizationId: assistant.organizationId,
          userId: uid,
          apiKeyId: request.apiKeyId,
          assistantId: assistant.id,
          conversationId: body.conversationId != null ? String(body.conversationId) : null,
          model,
          inputTokens: estimatedInputTokens,
          outputTokens: estimateTokensFromMessage(fullText),
        }).catch((e) => fastify.log.error(e, "finalizeChatUsage failed in stream"));
        await persistChatTurn({
          organizationId: assistant.organizationId,
          conversationId: body.conversationId != null ? String(body.conversationId) : null,
          assistantId: assistant.id,
          userText: message,
          assistantText: fullText,
        }).catch((e) => fastify.log.error(e, "persistChatTurn failed in stream"));
      }

      if (!streamEnded) send("done", { model });
    } catch (err) {
      if (err && err.name === "AbortError") {
        // expected on client disconnect or timeout — already handled
      } else {
        fastify.log.error(err);
        send("error", { error: err instanceof Error ? err.message : "Stream failed" });
      }
    } finally {
      clearTimeout(timeoutId);
      if (!streamEnded) {
        streamEnded = true;
        raw.end();
      }
    }
  });
};
