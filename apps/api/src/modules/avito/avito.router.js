"use strict";

/**
 * avito.router.js — routing decision engine.
 *
 * Combines agent.avitoMode + classifier output to decide
 * what action to take for each incoming message.
 *
 * Decisions:
 *   "autoreply" — AI generates + sends automatically
 *   "copilot"   — AI generates, saved to DB, NOT sent (human reviews)
 *   "human"     — no AI, message saved for human operator
 *   "skip"      — ignore completely (mode=off)
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
 * @param {object} agent           Prisma Agent row
 * @param {object} classification  Result from classifyMessage()
 * @returns {RoutingResult}
 */
function routeMessage(agent, classification) {
  // Resolve effective mode:
  // 1. agent.avitoMode (new field — explicit)
  // 2. Fallback: autoReply=false → "human", autoReply=true → "autoreply"
  const mode =
    (agent.avitoMode && agent.avitoMode.trim()) ||
    (agent.autoReply === false ? "human" : "autoreply");

  // Hard stop: agent has disabled Avito entirely
  if (mode === "off") {
    return { decision: "skip", reason: "avitoMode=off" };
  }

  // Classifier overrides: always escalate to human if required
  if (classification.requiresHuman) {
    // In copilot/autoreply modes, downgrade to human if classifier demands it
    if (mode !== "human") {
      return {
        decision: "human",
        reason:   `classifier:requiresHuman intent=${classification.intent}`,
      };
    }
  }

  // Respect explicit mode setting
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
