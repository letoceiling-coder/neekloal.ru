"use strict";

/**
 * avito.router.js — routing decision engine.
 *
 * Combines agent.avitoMode + classifier output + FSM lead state
 * to decide what action to take for each incoming message.
 *
 * Decisions:
 *   "autoreply" — AI generates + sends automatically
 *   "copilot"   — AI generates, saved to DB, NOT sent (human reviews)
 *   "human"     — no AI, message saved for human operator
 *   "skip"      — ignore completely (mode=off)
 *
 * FSM overrides (highest priority, applied before mode check):
 *   lead.isHot === true  → "human"
 *   lead.status === "HANDOFF" → "human"
 *   intent === "complaint"   → "human"
 */

/**
 * @typedef {"autoreply" | "copilot" | "human" | "skip"} Decision
 *
 * @typedef {{
 *   decision: Decision,
 *   reason:   string,
 * }} RoutingResult
 */

/**
 * Decide how to respond to a classified Avito message.
 *
 * @param {object}      agent           Prisma Agent row
 * @param {object}      classification  Result from classifyMessage()
 * @param {object|null} lead            AvitoLead FSM row (may be null on first message)
 * @returns {RoutingResult}
 */
function routeMessage(agent, classification, lead = null) {
  // ── FSM overrides (take precedence over agent mode) ──────────────────────────

  // Hot lead → always human
  if (lead && lead.isHot) {
    return { decision: "human", reason: "fsm:isHot=true" };
  }

  // HANDOFF state → always human (AI stopped, no reply sent)
  if (lead && lead.status === "HANDOFF") {
    return { decision: "human", reason: "fsm:status=HANDOFF" };
  }

  // Complaint → always escalate to human
  if (classification.intent === "complaint") {
    return { decision: "human", reason: "classifier:intent=complaint" };
  }

  // ── Resolve agent mode ───────────────────────────────────────────────────────
  const mode =
    (agent.avitoMode && agent.avitoMode.trim()) ||
    (agent.autoReply === false ? "human" : "autoreply");

  // Hard stop
  if (mode === "off") {
    return { decision: "skip", reason: "avitoMode=off" };
  }

  // Classifier requiresHuman still honoured in non-human modes
  if (classification.requiresHuman && mode !== "human") {
    return {
      decision: "human",
      reason:   `classifier:requiresHuman intent=${classification.intent}`,
    };
  }

  if (mode === "human") {
    return { decision: "human", reason: "avitoMode=human" };
  }

  if (mode === "copilot") {
    return {
      decision: "copilot",
      reason:   `avitoMode=copilot intent=${classification.intent}`,
    };
  }

  // Default: autoreply
  return {
    decision: "autoreply",
    reason:   `avitoMode=autoreply intent=${classification.intent} priority=${classification.priority}`,
  };
}

module.exports = { routeMessage };
