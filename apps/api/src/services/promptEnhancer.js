"use strict";

const { generateText } = require("./aiService");
const { selectModel }  = require("./modelRouter");

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, extra limbs, extra objects, distorted, watermark, text, ugly, deformed, out of focus, overexposed, underexposed, duplicate";

/**
 * Extract JSON from an LLM response that may be wrapped in markdown code fences.
 */
function safeParseJSON(raw) {
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    const ep = obj.enhancedPrompt || obj.enhanced_prompt || obj.prompt || "";
    const np = obj.negativePrompt || obj.negative_prompt || obj.negative || "";
    if (typeof ep === "string" && ep.trim()) {
      return {
        enhancedPrompt: ep.trim(),
        negativePrompt: typeof np === "string" && np.trim() ? np.trim() : DEFAULT_NEGATIVE,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build the LLM prompt for SDXL prompt engineering.
 * @param {string} userPrompt
 * @param {{ style?: string; aspectRatio?: string; systemPrompt?: string }} opts
 */
function buildEnhancerPrompt(userPrompt, opts = {}) {
  const { style, aspectRatio, systemPrompt } = opts;

  const styleHint = style ? ` Use ${style} visual style.` : "";
  const ratioHint = aspectRatio
    ? ` The image will be in ${aspectRatio} aspect ratio — adjust composition accordingly (e.g. ${
        aspectRatio === "16:9" || aspectRatio === "4:3"
          ? "wide landscape composition, horizon lines"
          : aspectRatio === "9:16"
          ? "vertical portrait composition, tall framing"
          : "centered square composition"
      }).`
    : "";

  const sysHint = systemPrompt
    ? `\n\nAdditional instructions from the user:\n${systemPrompt}`
    : "";

  return `You are an expert prompt engineer for Stable Diffusion SDXL image generation.${sysHint}

Transform the user input into a highly detailed, professional image generation prompt.

Rules:
- Keep the main subject/idea unchanged
- Specify the subject clearly and concisely
- Add art style (e.g. cinematic, illustration, Pixar 3D, anime, photorealistic)${styleHint}
- Add lighting description (e.g. cinematic lighting, soft diffused light, golden hour)
- Add composition suited for the aspect ratio${ratioHint}
- Add quality descriptors (ultra detailed, 8k, masterpiece, sharp focus)
- Keep it under 120 words
- Write in English regardless of input language

Also generate a negative prompt to exclude common defects.

Return ONLY valid JSON with no extra text:
{
  "enhancedPrompt": "...",
  "negativePrompt": "..."
}

User input: "${userPrompt}"`;
}

/**
 * Apply brain directives on top of an LLM-generated prompt and negative.
 * MUST items are appended unconditionally; auto-corrections fix known omissions.
 *
 * @param {string} llmPrompt
 * @param {string} llmNegative
 * @param {{ type?: string; directives?: { must: string[]; should: string[]; negative: string[] } } | null} brain
 * @returns {{ finalPrompt: string; finalNegative: string }}
 */
function applyDirectives(llmPrompt, llmNegative, brain) {
  let prompt   = llmPrompt;
  let negative = llmNegative;

  if (!brain) return { finalPrompt: prompt, finalNegative: negative };

  const { directives, type } = brain;
  const must    = directives?.must     ?? [];
  const should  = directives?.should   ?? [];
  const quality = directives?.quality  ?? [];
  const negDirs = directives?.negative ?? [];

  // ── Append MUST directives (these CANNOT be omitted) ─────────────────────
  const lp = prompt.toLowerCase();
  const mustToAdd = must.filter((m) => !lp.includes(m.toLowerCase()));
  if (mustToAdd.length) {
    prompt = [prompt.trim(), ...mustToAdd].join(", ");
  }

  // ── Append SHOULD directives (ALL — no slicing) ───────────────────────────
  const shouldToAdd = should.filter((s) => !lp.includes(s.toLowerCase()));
  if (shouldToAdd.length) {
    prompt = [prompt.trim(), ...shouldToAdd].join(", ");
  }

  // ── Append QUALITY directives ──────────────────────────────────────────────
  const qualityToAdd = quality.filter((q) => !lp.includes(q.toLowerCase()));
  if (qualityToAdd.length) {
    prompt = [prompt.trim(), ...qualityToAdd].join(", ");
  }

  // ── Auto-corrections ──────────────────────────────────────────────────────
  if (type === "character" && !prompt.toLowerCase().includes("full body")) {
    prompt += ", full body";
  }
  if (type === "logo" && !prompt.toLowerCase().includes("vector")) {
    prompt += ", vector, clean design";
  }
  if (type === "product" && !prompt.toLowerCase().includes("studio")) {
    prompt += ", studio lighting";
  }

  // ── Merge brain negative directives ──────────────────────────────────────
  const negLower = negative.toLowerCase();
  const negToAdd = negDirs.filter((n) => !negLower.includes(n.toLowerCase()));
  if (negToAdd.length) {
    negative = [negative.trim(), ...negToAdd].join(", ");
  }

  process.stdout.write(
    `[enhancer:final] promptLength=${prompt.length} mustCount=${must.length} qualityCount=${quality.length}\n`
  );

  return { finalPrompt: prompt, finalNegative: negative };
}

/**
 * Enhance a user prompt using Ollama LLM + brain directives.
 * Falls back to original prompt + default negative on any error.
 *
 * @param {string} userPrompt
 * @param {{
 *   style?: string;
 *   aspectRatio?: string;
 *   systemPrompt?: string;
 *   brain?: { type?: string; directives?: { must: string[]; should: string[]; negative: string[] } } | null;
 * }} [options]
 * @returns {Promise<{
 *   enhancedPrompt: string;
 *   negativePrompt: string;
 *   enhanced: boolean;
 *   appliedStyle: string | null;
 *   appliedAspectRatio: string | null;
 *   appliedSystemPrompt: boolean;
 * }>}
 */
async function enhancePrompt(userPrompt, options = {}) {
  const { style, aspectRatio, systemPrompt, brain } = options;
  process.stdout.write(`[enhancer] input: "${userPrompt.slice(0, 80)}"\n`);

  try {
    const model = selectModel("enhance");
    process.stdout.write(`[MODEL USED] ${model}\n`);
    const llmPrompt = buildEnhancerPrompt(userPrompt, { style, aspectRatio, systemPrompt });
    const raw = await generateText(model, llmPrompt);
    const parsed = safeParseJSON(raw);

    if (parsed) {
      // Apply brain directives on top of LLM output
      const { finalPrompt, finalNegative } = applyDirectives(
        parsed.enhancedPrompt,
        parsed.negativePrompt,
        brain ?? null
      );

      process.stdout.write(`[enhancer] output: "${finalPrompt.slice(0, 100)}"\n`);
      return {
        enhancedPrompt: finalPrompt,
        negativePrompt: finalNegative,
        enhanced: true,
        appliedStyle: style || null,
        appliedAspectRatio: aspectRatio || null,
        appliedSystemPrompt: !!(systemPrompt && systemPrompt.trim()),
      };
    }

    process.stdout.write(`[enhancer] JSON parse failed, using fallback. raw="${raw.slice(0, 80)}"\n`);
  } catch (err) {
    process.stdout.write(`[enhancer] LLM error: ${err.message}\n`);
  }

  // Fallback: still apply directives even without LLM
  const { finalPrompt, finalNegative } = applyDirectives(
    userPrompt,
    DEFAULT_NEGATIVE,
    brain ?? null
  );

  return {
    enhancedPrompt: finalPrompt,
    negativePrompt: finalNegative,
    enhanced: false,
    appliedStyle: null,
    appliedAspectRatio: null,
    appliedSystemPrompt: false,
  };
}

module.exports = { enhancePrompt, DEFAULT_NEGATIVE };
