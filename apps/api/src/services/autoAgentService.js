"use strict";

const { generateText } = require("./aiService");
const { buildAutoAgentPrompt } = require("./autoAgentPrompt");
const { ensureModelAvailable } = require("./modelRouter");

/**
 * Extract first JSON object from an LLM response string.
 * Handles cases where the model wraps JSON in markdown code fences or prose.
 * @param {string} text
 * @returns {object}
 */
function extractJson(text) {
  // Strip markdown code fences if present
  const stripped = text.replace(/```json?\n?/gi, "").replace(/```/g, "").trim();
  // Find outermost JSON object
  const start = stripped.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in LLM response");
  // Walk to find matching closing brace
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error("Malformed JSON object in LLM response");
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Validate that the parsed object has the expected shape.
 * @param {unknown} obj
 * @returns {{ systemPrompt: string; config: object }}
 */
function validateResult(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Result is not an object");
  const r = /** @type {Record<string, unknown>} */ (obj);
  if (typeof r.systemPrompt !== "string" || !r.systemPrompt.trim()) {
    throw new Error("Missing or empty systemPrompt in generated config");
  }
  if (!r.config || typeof r.config !== "object") {
    throw new Error("Missing config object in generated result");
  }
  return { systemPrompt: r.systemPrompt.trim(), config: r.config };
}

/**
 * Generate assistant config via LLM.
 * Retries once on parse failure.
 *
 * @param {string} description   User's business description
 * @param {string} model         Ollama model name to use
 * @returns {Promise<{ systemPrompt: string; config: object }>}
 */
async function generateAutoAgent(description, model) {
  const resolvedModel = await ensureModelAvailable(model, process.env.OLLAMA_URL);
  const prompt = buildAutoAgentPrompt(description);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await generateText(resolvedModel, prompt);
    try {
      const parsed = extractJson(text);
      return validateResult(parsed);
    } catch (err) {
      console.warn(`[autoAgentService] attempt ${attempt} JSON parse failed:`, err.message);
      if (attempt === 2) {
        throw new Error(`LLM returned unparseable JSON after ${attempt} attempts: ${err.message}`);
      }
    }
  }
  // unreachable, but satisfies linter
  throw new Error("Generation failed");
}

module.exports = { generateAutoAgent };
