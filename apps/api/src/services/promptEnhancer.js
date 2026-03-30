"use strict";

const { generateText } = require("./aiService");

const OLLAMA_MODEL = process.env.IMAGE_ENHANCER_MODEL || "llama3:8b";

const DEFAULT_NEGATIVE =
  "blurry, low quality, bad anatomy, extra limbs, extra objects, distorted, watermark, text, ugly, deformed, out of focus, overexposed, underexposed, duplicate";

/**
 * Extract JSON from an LLM response that may be wrapped in markdown code fences.
 * @param {string} raw
 * @returns {{ enhancedPrompt: string; negativePrompt: string } | null}
 */
function safeParseJSON(raw) {
  // Strip markdown code fences
  let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

  // Find the first { ... } block
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
 * @param {string} [style]
 * @returns {string}
 */
function buildEnhancerPrompt(userPrompt, style) {
  const styleHint = style ? ` Use ${style} visual style.` : "";
  return `You are an expert prompt engineer for Stable Diffusion SDXL image generation.

Transform the user input into a highly detailed, professional image generation prompt.

Rules:
- Keep the main subject/idea unchanged
- Specify the subject clearly and concisely
- Add art style (e.g. cinematic, illustration, Pixar 3D, anime, photorealistic)${styleHint}
- Add lighting description (e.g. cinematic lighting, soft diffused light, golden hour)
- Add composition (e.g. centered, full body, close-up portrait, wide angle)
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
 * Enhance a user prompt using Ollama LLM.
 * Falls back to original prompt + default negative on any error.
 *
 * @param {string} userPrompt
 * @param {{ style?: string }} [options]
 * @returns {Promise<{ enhancedPrompt: string; negativePrompt: string; enhanced: boolean }>}
 */
async function enhancePrompt(userPrompt, options = {}) {
  const { style } = options;
  process.stdout.write(`[enhancer] input: "${userPrompt.slice(0, 80)}"\n`);

  try {
    const llmPrompt = buildEnhancerPrompt(userPrompt, style);
    const raw = await generateText(OLLAMA_MODEL, llmPrompt);
    const parsed = safeParseJSON(raw);

    if (parsed) {
      process.stdout.write(`[enhancer] output: "${parsed.enhancedPrompt.slice(0, 80)}"\n`);
      return { ...parsed, enhanced: true };
    }

    process.stdout.write(`[enhancer] JSON parse failed, using fallback. raw="${raw.slice(0, 80)}"\n`);
  } catch (err) {
    process.stdout.write(`[enhancer] LLM error: ${err.message}\n`);
  }

  // Fallback
  return {
    enhancedPrompt: userPrompt,
    negativePrompt: DEFAULT_NEGATIVE,
    enhanced: false,
  };
}

module.exports = { enhancePrompt, DEFAULT_NEGATIVE };
