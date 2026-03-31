"use strict";

/**
 * aiOrchestrator.js — Pipeline builder (Brain V3).
 *
 * Pure function — no side effects, no async, no DB, no LLM.
 * Takes request context, returns an ordered list of steps (pipeline).
 *
 * The pipeline DRIVES the execution in routes/image.js:
 *   brain → [enhance] → generate(mode) → [postprocess]
 */

const STEP_LABELS = {
  brain:       "Анализ промпта",
  enhance:     "Улучшение AI",
  generate:    "Генерация изображения",
  postprocess: "Постобработка",
};

const MODE_LABELS = {
  text:       "Текст",
  variation:  "Вариации",
  reference:  "По образцу",
  inpaint:    "Редактирование",
  controlnet: "ControlNet",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract explicit variation count from prompt.
 * "сделай 4 варианта" → 4, "несколько" → null (caller uses default).
 */
function extractVariationCount(prompt) {
  const m = prompt.match(/(\d+)\s*(вари|вариант|variant|var|штук|изображ)/);
  if (m) return Math.min(Math.max(parseInt(m[1], 10), 2), 8);
  return null;
}

function isVariationPrompt(p) {
  return (
    p.includes("варианты")  || p.includes("вариантов") || p.includes("несколько") ||
    p.includes("variations") || p.includes("multiple")  || p.includes("different versions")
  );
}

function isRemoveBgPrompt(p) {
  return (
    p.includes("убери фон")       || p.includes("убрать фон")       ||
    p.includes("без фона")        || p.includes("remove background") ||
    p.includes("remove bg")       || p.includes("transparent background") ||
    p.includes("прозрачный фон")
  );
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   prompt:       string;
 *   hasReference?: boolean;
 *   hasMask?:     boolean;
 *   smartMode?:   boolean;
 * }} input
 *
 * @returns {{
 *   steps: Array<{type:string; [key:string]: any; label:string}>;
 *   meta:  { autoMode: boolean; autoRemoveBg: boolean };
 * }}
 */
function buildPipeline({ prompt = "", hasReference = false, hasMask = false, smartMode = true }) {
  const steps = [];
  const meta  = { autoMode: false, autoRemoveBg: false };
  const p     = prompt.toLowerCase();

  // ── Step 1: Always analyze ─────────────────────────────────────────────────
  steps.push({
    type:   "brain",
    action: "analyze",
    label:  STEP_LABELS.brain,
  });

  // ── Step 2: Smart enhance (if smartMode) ──────────────────────────────────
  if (smartMode !== false) {
    steps.push({
      type:  "enhance",
      model: process.env.ENHANCER_MODEL || "qwen2.5:7b",
      label: STEP_LABELS.enhance,
    });
    meta.autoMode = true;
  }

  // ── Step 3: Generate — mode decision ──────────────────────────────────────
  if (isVariationPrompt(p)) {
    const count = extractVariationCount(p) || 4;
    steps.push({
      type:  "generate",
      mode:  "variation",
      count,
      label: `${STEP_LABELS.generate} (вариации ×${count})`,
    });
  } else if (hasMask) {
    steps.push({
      type:  "generate",
      mode:  "inpaint",
      label: `${STEP_LABELS.generate} (редактирование)`,
    });
  } else if (hasReference) {
    steps.push({
      type:  "generate",
      mode:  "reference",
      label: `${STEP_LABELS.generate} (по образцу)`,
    });
  } else {
    steps.push({
      type:  "generate",
      mode:  "text",
      label: STEP_LABELS.generate,
    });
  }

  // ── Step 4: Auto post-process ─────────────────────────────────────────────
  if (isRemoveBgPrompt(p)) {
    steps.push({
      type:   "postprocess",
      action: "remove_bg",
      label:  `${STEP_LABELS.postprocess} (удаление фона)`,
    });
    meta.autoRemoveBg = true;
  }

  process.stdout.write(
    `[orchestrator] ${steps.map((s) => s.type + (s.mode ? ":" + s.mode : (s.action ? ":" + s.action : ""))).join(" → ")}\n`
  );

  return { steps, meta };
}

module.exports = { buildPipeline, STEP_LABELS, MODE_LABELS };
