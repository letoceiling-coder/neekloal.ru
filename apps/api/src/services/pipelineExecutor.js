"use strict";

/**
 * pipelineExecutor.js — Executes a pipeline built by aiOrchestrator.
 *
 * Execution contract:
 *   brain      → runs analyzePrompt() inline, updates context.brain
 *   enhance    → runs enhancePrompt() inline, updates context.prompt / context.negative
 *   generate   → NOT executed here (async BullMQ) — marked "queued"
 *   postprocess→ NOT executed here (depends on generation) — marked "pending"
 *
 * PARTIAL FAIL SUPPORT: each step failure is caught independently.
 * The pipeline continues even if one step fails.
 */

const { analyzePrompt } = require("./aiBrainV2");
const { enhancePrompt } = require("./promptEnhancer");

// ── Step executor (single step) ───────────────────────────────────────────────

async function executeStep(step, stepResult, context) {
  switch (step.type) {

    // ── Brain: synchronous prompt analysis ─────────────────────────────────
    case "brain": {
      const brain = analyzePrompt(context.prompt, {
        enableVariations: context.enableVariations,
        referenceImage:   context.hasReference,
        mask:             context.hasMask,
      });
      context.brain = brain;
      stepResult.output = {
        type:           brain.type,
        typeLabel:      brain.typeLabel,
        style:          brain.style,
        suggestedMode:  brain.suggestedMode,
        directivesCount:
          (brain.directives?.must?.length  ?? 0) +
          (brain.directives?.should?.length ?? 0),
        qualityCount: brain.directives?.quality?.length ?? 0,
      };
      stepResult.status = "done";
      break;
    }

    // ── Enhance: LLM prompt enhancement ────────────────────────────────────
    case "enhance": {
      if (context.skipEnhance) {
        stepResult.status = "skipped";
        stepResult.output = { reason: "negativePrompt provided by user" };
        break;
      }

      // Compose system prompt: user setting + brain composition + brain hints
      const resolvedSystemPrompt = [
        context.systemPrompt,
        context.brain?.composition,
        context.brain?.enhancedPromptHints,
      ].filter(Boolean).join("\n") || null;

      const finalStyle       = context.style       || context.brain?.style          || null;
      const finalAspectRatio = context.aspectRatio || context.brain?.aspectRatioLabel || null;

      const res = await enhancePrompt(context.prompt, {
        style:        finalStyle,
        aspectRatio:  finalAspectRatio,
        systemPrompt: resolvedSystemPrompt,
        brain:        context.brain,
      });

      context.prompt    = res.enhancedPrompt;
      context.negative  = res.negativePrompt;
      context.enhanced  = res.enhanced;
      context.enhanceResult = res;

      stepResult.status = "done";
      stepResult.output = {
        promptLength: context.prompt.length,
        enhanced:     res.enhanced,
        appliedStyle: res.appliedStyle,
      };
      break;
    }

    // ── Generate: async via BullMQ — not executed inline ───────────────────
    case "generate": {
      stepResult.status = "queued";
      stepResult.output = { mode: step.mode, jobId: context.jobId };
      break;
    }

    // ── Postprocess: depends on completed generation ────────────────────────
    case "postprocess": {
      stepResult.status = "pending";
      stepResult.output = { action: step.action };
      break;
    }

    default: {
      stepResult.status = "done";
      stepResult.output = { note: "unknown step type, noop" };
    }
  }
}

// ── Pipeline runner ───────────────────────────────────────────────────────────

/**
 * @param {{ steps: Array<{type:string; [key:string]:any}> }} pipeline
 * @param {{
 *   prompt:           string;     // mutable — updated by enhance step
 *   negative:         string|null; // mutable — updated by enhance step
 *   brain:            object|null; // mutable — set by brain step
 *   enhanceResult:    object|null; // mutable — set by enhance step
 *   style:            string|null;
 *   aspectRatio:      string|null;
 *   systemPrompt:     string|null;
 *   enableVariations: boolean;
 *   hasReference:     boolean;
 *   hasMask:          boolean;
 *   skipEnhance:      boolean;
 *   jobId:            string;
 * }} context
 *
 * @returns {Promise<Array<{type:string; status:string; output:object|null; error:string|null; durationMs:number}>>}
 */
async function executePipeline(pipeline, context) {
  const results = [];

  for (const step of pipeline.steps) {
    const stepResult = {
      type:      step.type,
      action:    step.action || null,
      mode:      step.mode   || null,
      label:     step.label  || step.type,
      status:    "pending",
      output:    null,
      error:     null,
      startedAt: Date.now(),
      finishedAt: null,
    };

    try {
      stepResult.status = "running";
      await executeStep(step, stepResult, context);
    } catch (err) {
      stepResult.status = "failed";
      stepResult.error  = err.message;
      process.stderr.write(`[executor:error] ${step.type}: ${err.message}\n`);
      // ⚠️ Do NOT rethrow — partial failure support
    }

    stepResult.finishedAt = Date.now();
    stepResult.durationMs = stepResult.finishedAt - stepResult.startedAt;

    process.stdout.write(
      `[executor:step] ${step.type} → ${stepResult.status}` +
      (stepResult.durationMs > 0 ? ` (${stepResult.durationMs}ms)` : "") + "\n"
    );

    results.push(stepResult);
  }

  process.stdout.write(
    `[executor:done] steps=${results.length} ` +
    `ok=${results.filter((r) => r.status === "done").length} ` +
    `failed=${results.filter((r) => r.status === "failed").length}\n`
  );

  return results;
}

module.exports = { executePipeline };
