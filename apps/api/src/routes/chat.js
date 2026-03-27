"use strict";

const { findById } = require("../services/assistantsStore");
const { listByAssistantId } = require("../services/knowledgeStore");
const authMiddleware = require("../middleware/auth");

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
  fastify.post("/chat", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const message = body.message;
    const assistantId = body.assistantId;

    if (assistantId == null || String(assistantId).trim() === "") {
      return reply.code(400).send({ error: "assistantId is required" });
    }

    const assistant = findById(String(assistantId));
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const uid = request.userId;
    if (assistant.userId !== uid) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const model = assistant.model;

    const knowledgeRows = listByAssistantId(assistant.id).slice(0, 3);
    const knowledgeBlock =
      knowledgeRows.length > 0 ? knowledgeRows.map((k) => k.content).join("\n\n") : "";
    const prompt = buildStructuredPrompt(assistant.systemPrompt, knowledgeBlock, message);
    fastify.log.info({ prompt }, "chat prompt");

    try {
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
      return { reply: replyText, model };
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ error: error.message || "Internal Server Error" });
    }
  });
};
