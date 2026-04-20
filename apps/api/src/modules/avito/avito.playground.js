"use strict";

/**
 * avito.playground.js — tester-only chat for Avito AI pipeline.
 *
 * Mirrors the Avito processor logic (classifier + FSM + knowledge + prompt +
 * Ollama) but DOES NOT persist anything:
 *   - no AgentConversation row
 *   - no AvitoLead row
 *   - no AvitoAuditLog
 *   - no message sending to Avito API
 *
 * Callers provide the full short-lived dialog in `messages` and keep the
 * FSM status on the client side, passing it back in `fsmStatus`.
 *
 * Endpoints:
 *   POST /avito/playground/chat
 *     body: {
 *       agentId: string,
 *       messages: [{ role: "user" | "assistant", content: string }, ...],
 *       fsmStatus?: "NEW" | "QUALIFYING" | "INTERESTED" | "HANDOFF" | "CLOSED" | "LOST"
 *     }
 *     returns: {
 *       reply: string,
 *       classification: { intent, priority, isHotLead },
 *       fsm: { previous, next, phone: string | null },
 *       knowledge: { source: "rag" | "db" | "none", chars: number },
 *       model: { requested, used },
 *       tokens: { prompt, completion, total } | null,
 *       systemPromptPreview: string   // first 2000 chars for debugging
 *     }
 */

const prisma                        = require("../../lib/prisma");
const authMiddleware                = require("../../middleware/auth");
const { selectModel }               = require("../../services/modelRouter");
const { classifyMessage }           = require("./avito.classifier");
const { resolveNextState,
        extractPhone }              = require("./avito.fsm");
const { buildAvitoSystemPrompt }    = require("./avito.prompt");
const { loadAvitoKnowledgeBlock }   = require("./avito.knowledge");

// ── Ollama helpers (mirror agentRuntimeV2 but without DB persistence) ────────

function getOllamaChatUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) throw new Error("OLLAMA_URL is not set");
  return `${base.replace(/\/$/, "")}/api/chat`;
}

function buildOllamaBody(model, messages) {
  return { model, messages, stream: false };
}

// ── Validation ───────────────────────────────────────────────────────────────

const VALID_FSM_STATUSES = new Set([
  "NEW", "QUALIFYING", "INTERESTED", "HANDOFF", "CLOSED", "LOST",
]);

const MAX_HISTORY = 40;
const MAX_MESSAGE_CHARS = 4000;

function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role ?? "").trim().toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const content = String(m.content ?? "").slice(0, MAX_MESSAGE_CHARS);
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  // Keep tail only
  return out.slice(-MAX_HISTORY);
}

// ── Fastify plugin ───────────────────────────────────────────────────────────

module.exports = async function avitoPlaygroundModule(fastify) {

  // ── POST /avito/playground/chat ────────────────────────────────────────
  fastify.post(
    "/avito/playground/chat",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const body = request.body && typeof request.body === "object" ? request.body : {};
      const agentId = String(body.agentId ?? "").trim();
      const rawMessages = Array.isArray(body.messages) ? body.messages : [];
      const messages = normalizeMessages(rawMessages);

      if (!agentId) {
        return reply.code(400).send({ error: "agentId is required" });
      }
      if (messages.length === 0) {
        return reply.code(400).send({ error: "messages must contain at least one user message" });
      }

      const last = messages[messages.length - 1];
      if (last.role !== "user") {
        return reply.code(400).send({ error: "last message must have role=\"user\"" });
      }

      // ── Load agent (scoped to caller organization) + assistant ──────────
      const agent = await prisma.agent.findFirst({
        where:   { id: agentId, organizationId: request.organizationId, deletedAt: null },
        include: { assistant: true },
      });
      if (!agent) return reply.code(404).send({ error: "Agent not found" });

      // ── Resolve FSM status (client-provided or NEW) ─────────────────────
      const requestedStatus = String(body.fsmStatus ?? "").trim().toUpperCase();
      const currentStatus = VALID_FSM_STATUSES.has(requestedStatus) ? requestedStatus : "NEW";
      const pseudoLead = { status: currentStatus };

      // ── 1. Classify last user message ───────────────────────────────────
      const classification = classifyMessage(last.content);

      // ── 2. FSM transition (never downgrades) ────────────────────────────
      let nextStatus = resolveNextState(pseudoLead, classification);

      // ── 3. Phone extraction → force HANDOFF ─────────────────────────────
      const phone = extractPhone(last.content);
      if (phone) nextStatus = "HANDOFF";

      // ── 4. HANDOFF short-circuit — mirror processor behaviour ───────────
      if (nextStatus === "HANDOFF") {
        return {
          reply: "",
          stopped: true,
          reason: "handoff",
          classification,
          fsm: { previous: currentStatus, next: nextStatus, phone: phone ?? null },
          knowledge: { source: "none", chars: 0 },
          model: { requested: agent.model || null, used: null },
          tokens: null,
          systemPromptPreview: "",
        };
      }

      // ── 5. Knowledge block (RAG → DB fallback) ──────────────────────────
      const { knowledgeBlock, source: knowledgeSource } = await loadAvitoKnowledgeBlock({
        assistantId:    agent.assistantId,
        organizationId: agent.organizationId,
        message:        last.content,
      });

      // ── 6. System prompt (uses the NEW status, not previous) ────────────
      const systemPrompt = buildAvitoSystemPrompt({
        lead:      { status: nextStatus },
        agent,
        assistant: agent.assistant || null,
        knowledgeBlock,
      });

      // ── 7. Ollama call (no persistence) ─────────────────────────────────
      const selectedModel = agent.model || selectModel("chat");
      const fullMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
      ];

      const ollamaStart = Date.now();
      let ollamaRes;
      try {
        ollamaRes = await fetch(getOllamaChatUrl(), {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(buildOllamaBody(selectedModel, fullMessages)),
        });
      } catch (err) {
        return reply.code(502).send({
          error: `Ollama request failed: ${err && err.message ? err.message : String(err)}`,
        });
      }

      if (!ollamaRes.ok) {
        const errText = await ollamaRes.text().catch(() => "");
        return reply.code(502).send({
          error: `Ollama /api/chat ${ollamaRes.status}: ${errText.slice(0, 300)}`,
        });
      }

      const data    = await ollamaRes.json();
      const content = data.message?.content ?? "";
      const pTok    = Number(data.prompt_eval_count) || 0;
      const cTok    = Number(data.eval_count)         || 0;
      const elapsed = Date.now() - ollamaStart;

      process.stdout.write(
        `[avito:playground] agent=${agentId} model=${selectedModel} ` +
        `status=${currentStatus}->${nextStatus} kb=${knowledgeSource} ` +
        `chars=${content.length} tokens=${pTok}+${cTok} ms=${elapsed}\n`
      );

      return {
        reply: content,
        stopped: false,
        classification,
        fsm: {
          previous: currentStatus,
          next:     nextStatus,
          phone:    phone ?? null,
        },
        knowledge: {
          source: knowledgeSource,
          chars:  knowledgeBlock.length,
        },
        model: {
          requested: agent.model || null,
          used:      selectedModel,
        },
        tokens: {
          prompt:     pTok,
          completion: cTok,
          total:      pTok + cTok,
        },
        durationMs: elapsed,
        systemPromptPreview: systemPrompt.slice(0, 2000),
      };
    }
  );
};
