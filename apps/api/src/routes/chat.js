"use strict";

const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { retrieveForChat } = require("../services/rag");
const { runAgent } = require("../services/agent");
const { runAgentV2 } = require("../services/agentV2");
const { resolveModel, ensureModelAvailable } = require("../services/modelRouter");
const authMiddleware = require("../middleware/auth");
const rateLimitMiddleware = require("../middleware/rateLimit");

function estimateTokensFromMessage(message) {
  const text = message == null ? "" : String(message);
  return Math.round(text.length / 4);
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
  fastify.post("/chat", { preHandler: [authMiddleware, rateLimitMiddleware] }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const message = body.message;
    const assistantId = body.assistantId;

    if (assistantId == null || String(assistantId).trim() === "") {
      return reply.code(400).send({ error: "assistantId is required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: { id: String(assistantId), userId: request.userId },
    });
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const uid = request.userId;

    let model =
      assistant.model === "auto"
        ? resolveModel(message)
        : assistant.model;
    model = await ensureModelAvailable(model, process.env.OLLAMA_URL);
    console.log("MODEL SELECTED:", model);

    let knowledgeBlock = "";

    if (qdrant.isRagEnabled()) {
      const retrieved = await retrieveForChat(fastify, assistant.id, message, 5);
      knowledgeBlock = retrieved.knowledgeBlock;
    }

    if (!knowledgeBlock.trim()) {
      const knowledgeRows = await prisma.knowledge.findMany({
        where: { assistantId: assistant.id },
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
      where: { userId: uid, assistantId: assistant.id },
      include: { tools: true },
    });

    try {
      if (agentRecord) {
        const useV2 = String(agentRecord.mode || "v1").toLowerCase() === "v2";
        const runner = useV2 ? runAgentV2 : runAgent;
        const { reply: replyText, model: modelOut } = await runner({
          assistant,
          message,
          knowledgeBlock,
          model,
          agent: agentRecord,
        });

        await prisma.usage.create({
          data: {
            userId: uid,
            apiKeyId: request.apiKeyId,
            model: modelOut,
            tokens: estimateTokensFromMessage(message),
          },
        });

        return { reply: replyText, model: modelOut };
      }

      const prompt = buildStructuredPrompt(assistant.systemPrompt, knowledgeBlock, message);
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

      await prisma.usage.create({
        data: {
          userId: uid,
          apiKeyId: request.apiKeyId,
          model,
          tokens: estimateTokensFromMessage(message),
        },
      });

      return { reply: replyText, model };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message || "Internal Server Error" });
    }
  });
};
