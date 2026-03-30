"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const { generateAutoAgent } = require("../services/autoAgentService");
const { explainConfig } = require("../services/autoAgentExplain");
const { buildRefinePrompt } = require("../services/autoAgentPrompt");
const { generateText } = require("../services/aiService");
const { ensureModelAvailable } = require("../services/modelRouter");

/**
 * Extract + validate auto-agent JSON from LLM response (shared with autoAgentService).
 * Duplicated inline to avoid coupling — kept minimal.
 */
function extractJson(text) {
  const stripped = text.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in LLM response");
  let depth = 0; let end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("Malformed JSON in LLM response");
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Resolve model from assistantId or fallback.
 */
async function resolveModel(organizationId, assistantId) {
  let model = process.env.DEFAULT_MODEL || "llama3:8b";
  if (assistantId) {
    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, organizationId, deletedAt: null },
      select: { model: true },
    });
    if (assistant?.model) model = assistant.model;
  }
  return model;
}

/**
 * AI utility routes.
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function aiRoutes(fastify) {
  /**
   * POST /ai/auto-agent
   * Body: { description: string, assistantId?: string }
   * Returns: { systemPrompt, config, explanation }
   *
   * Does NOT persist — preview only. Apply via PATCH /assistants/:id.
   */
  fastify.post("/ai/auto-agent", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const description  = body.description  != null ? String(body.description).trim()  : "";
    const assistantId  = body.assistantId  != null ? String(body.assistantId).trim()  : "";

    if (!description)        return reply.code(400).send({ error: "description is required" });
    if (description.length < 5) return reply.code(400).send({ error: "description is too short" });

    const model = await resolveModel(request.organizationId, assistantId);
    fastify.log.info({ model, descriptionLen: description.length }, "[auto-agent] generating config");

    try {
      const result = await generateAutoAgent(description, model);
      const explanation = explainConfig(result.config, result.systemPrompt);
      fastify.log.info({ model }, "[auto-agent] config generated successfully");
      return { ...result, explanation };
    } catch (err) {
      fastify.log.error(err, "[auto-agent] generation failed");
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Config generation failed" });
    }
  });

  /**
   * POST /ai/auto-agent/refine
   * Body: { config, systemPrompt, instruction, assistantId? }
   * Returns: { systemPrompt, config, explanation }
   *
   * Uses LLM to improve an existing config per a plain-text instruction.
   */
  fastify.post("/ai/auto-agent/refine", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const instruction  = body.instruction  != null ? String(body.instruction).trim()  : "";
    const systemPrompt = body.systemPrompt != null ? String(body.systemPrompt).trim() : "";
    const config       = body.config && typeof body.config === "object" ? body.config : {};
    const assistantId  = body.assistantId  != null ? String(body.assistantId).trim()  : "";

    if (!instruction) return reply.code(400).send({ error: "instruction is required" });
    if (!systemPrompt && Object.keys(config).length === 0) {
      return reply.code(400).send({ error: "config or systemPrompt is required" });
    }

    const rawModel = await resolveModel(request.organizationId, assistantId);
    const model = await ensureModelAvailable(rawModel, process.env.OLLAMA_URL);
    fastify.log.info({ model, instruction: instruction.slice(0, 60) }, "[refine] refining config");

    const prompt = buildRefinePrompt(config, systemPrompt, instruction);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text   = await generateText(model, prompt);
        const parsed = extractJson(text);

        if (typeof parsed.systemPrompt !== "string" || !parsed.config) {
          throw new Error("Missing required fields in refined config");
        }

        const explanation = explainConfig(parsed.config, parsed.systemPrompt);
        fastify.log.info({ model }, "[refine] config refined successfully");
        return { systemPrompt: parsed.systemPrompt.trim(), config: parsed.config, explanation };
      } catch (err) {
        fastify.log.warn({ attempt, err: err.message }, "[refine] parse failed, retrying");
        if (attempt === 2) {
          return reply.code(500).send({ error: `Refine failed after ${attempt} attempts: ${err.message}` });
        }
      }
    }
  });
};
