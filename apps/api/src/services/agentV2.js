"use strict";

const prisma = require("../lib/prisma");
const { executeTool } = require("./tools");
const { buildFinalPrompt } = require("./chatPrompt");

const MAX_LOOPS = 5;
const VALID_ACTIONS = new Set(["tool", "final"]);

/** Injected into every planner / fallback SYSTEM block */
const SYSTEM_HARD_RULE = "Only use tools listed. Never invent tools.";

function getGlobalContextMax() {
  const n = parseInt(process.env.AGENT_V2_GLOBAL_CONTEXT_MAX || "14000", 10);
  if (Number.isNaN(n) || n < 12000) return 12000;
  if (n > 15000) return 15000;
  return n;
}

function getExecutionTimeoutMs() {
  const n = parseInt(process.env.AGENT_V2_EXECUTION_TIMEOUT_MS || "10000", 10);
  return Number.isNaN(n) || n < 1000 ? 10000 : n;
}

function getMaxToolCalls() {
  const n = parseInt(process.env.AGENT_V2_MAX_TOOL_CALLS || "3", 10);
  return Number.isNaN(n) || n < 1 ? 3 : n;
}

function getToolContextMax() {
  const n = parseInt(process.env.AGENT_V2_TOOL_CONTEXT_MAX || "1500", 10);
  if (Number.isNaN(n) || n < 1000) return 1000;
  if (n > 2000) return 2000;
  return n;
}

function getGenerateUrl() {
  const base = process.env.OLLAMA_URL;
  if (!base) {
    throw new Error("OLLAMA_URL is not set");
  }
  return `${base.replace(/\/$/, "")}/api/generate`;
}

/**
 * @param {string} model
 * @param {string} prompt
 */
async function ollamaGenerate(model, prompt) {
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
    throw new Error(`Ollama generate failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.response != null ? String(data.response) : "";
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function parseAgentJson(raw) {
  try {
    const t = String(raw).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1].trim() : t;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * @param {unknown} decision — parsed JSON from LLM
 * @returns {{ valid: boolean; reason?: string; normalized?: { action: string; text?: string; toolId?: string; input?: unknown } }}
 */
function validateDecision(decision) {
  if (!decision || typeof decision !== "object") {
    return { valid: false, reason: "not_object" };
  }
  const action = decision.action != null ? String(decision.action).trim() : "";
  if (!VALID_ACTIONS.has(action)) {
    return { valid: false, reason: "invalid_action" };
  }
  if (action === "final") {
    const text = decision.text;
    if (text == null || String(text).trim() === "") {
      return { valid: false, reason: "final_requires_text" };
    }
    return {
      valid: true,
      normalized: { action: "final", text: String(text) },
    };
  }
  const toolId = decision.toolId != null ? String(decision.toolId).trim() : "";
  if (!toolId) {
    return { valid: false, reason: "tool_requires_toolId" };
  }
  return {
    valid: true,
    normalized: { action: "tool", toolId, input: decision.input },
  };
}

/**
 * @param {unknown} parsed
 */
function decisionSignature(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return "";
  }
  const a = String(parsed.action || "").trim();
  if (a === "final") {
    return `final:${String(parsed.text || "").slice(0, 240)}`;
  }
  if (a === "tool") {
    return `tool:${String(parsed.toolId || "").trim()}`;
  }
  return `other:${a}`;
}

/**
 * @param {string} toolResultJson
 */
function toolExecutionLooksFailed(toolResultJson) {
  try {
    const j = JSON.parse(toolResultJson);
    if (j && typeof j === "object") {
      return j.ok !== true;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * @param {string} toolId
 * @param {string} toolResultJson
 * @param {boolean} success
 */
function buildStructuredToolResult(toolId, toolResultJson, success) {
  const maxInner = Math.max(200, getToolContextMax() - 200);
  let data;
  try {
    data = JSON.parse(toolResultJson);
  } catch {
    data = { raw: toolResultJson.slice(0, maxInner) };
  }
  const obj = {
    tool: toolId,
    success,
    data,
  };
  let s = JSON.stringify(obj);
  if (s.length > getToolContextMax()) {
    s = JSON.stringify({
      tool: toolId,
      success,
      data: {
        truncated: true,
        preview: s.slice(0, getToolContextMax() - 120),
      },
    });
  }
  return `TOOL RESULT:\n${s}`;
}

/**
 * @param {Array<{ id: string; type: string; config: unknown }>} tools
 */
function formatToolsBlock(tools) {
  if (!tools || tools.length === 0) {
    return "(no tools registered)";
  }
  return tools
    .map((t) => {
      const cfg =
        t.config && typeof t.config === "object"
          ? JSON.stringify(t.config).slice(0, 500)
          : String(t.config);
      return `- id: ${t.id}\n  type: ${t.type}\n  config: ${cfg}`;
    })
    .join("\n");
}

/**
 * Full planner prompt length includes rules, tools, knowledge, user, history.
 * @param {object} assistant — Prisma assistant (systemPrompt)
 */
function buildPlannerPrompt(rules, toolsBlock, kb, userMsg, assistant, historyLines, fsmStage, context) {
  const historyBlock =
    historyLines.length === 0
      ? "(none yet)"
      : historyLines.map((h, idx) => `[${idx + 1}] ${h}`).join("\n\n");

  const agentRules = `${SYSTEM_HARD_RULE}

${rules}

TOOLS (available):
${toolsBlock}

Respond with exactly one JSON object:
{"action":"final","text":"<answer to user>"}
OR
{"action":"tool","toolId":"<uuid>","input":<optional object>}`;

  return buildFinalPrompt({
    assistant,
    knowledge: kb,
    message: userMsg,
    agent: { rules: agentRules },
    appendAfterUser: `PREVIOUS TOOL RESULTS (structured JSON per entry, size-capped):
${historyBlock}`,
    fsmStage,
    context,
  });
}

/**
 * Drop oldest tool result rows first; keep last 1–2 when possible; then truncate last line.
 * Knowledge block is never removed (only PREVIOUS TOOL RESULTS shrink).
 * @returns {{ lines: string[]; truncated: boolean }}
 */
function trimHistoryForBudget(rules, toolsBlock, kb, userMsg, assistant, toolHistory, maxChars, fsmStage, context) {
  const lines = [...toolHistory];
  let truncated = false;

  function promptLen() {
    return buildPlannerPrompt(
      rules,
      toolsBlock,
      kb,
      userMsg,
      assistant,
      lines,
      fsmStage,
      context
    ).length;
  }

  while (lines.length > 2 && promptLen() > maxChars) {
    lines.shift();
    truncated = true;
  }
  while (lines.length > 1 && promptLen() > maxChars) {
    lines.shift();
    truncated = true;
  }
  if (lines.length === 1 && promptLen() > maxChars) {
    const cap = Math.max(400, Math.floor(maxChars / 4));
    const before = lines[0];
    lines[0] = before.length > cap ? `${before.slice(0, cap)}…` : before;
    if (lines[0] !== before) truncated = true;
  }
  return { lines, truncated };
}

async function llmFallbackPlain(model, rules, kb, userMsg, assistant, note, fsmStage, context) {
  const agentRules = `${SYSTEM_HARD_RULE}

${rules}

${note}

Answer in plain text only. Do not output JSON.`;
  const prompt = buildFinalPrompt({
    assistant,
    knowledge: kb,
    message: userMsg,
    agent: { rules: agentRules },
    fsmStage,
    context,
  });
  return ollamaGenerate(model, prompt);
}

function buildMaxStepsFallbackPrompt(rules, kb, userMsg, assistant, fsmStage, context) {
  const agentRules = `${SYSTEM_HARD_RULE}

${rules}

The agent reached the maximum number of steps without a final answer. Summarize what you know and answer the user helpfully in plain text. Do not output JSON.`;
  return buildFinalPrompt({
    assistant,
    knowledge: kb,
    message: userMsg,
    agent: { rules: agentRules },
    fsmStage,
    context,
  });
}

/**
 * Multi-step agent (max 5 LLM rounds): decision → tool(s) → final.
 * @param {object} params
 * @param {object} params.assistant
 * @param {unknown} params.message
 * @param {string} params.knowledgeBlock
 * @param {string} params.model
 * @param {object} params.agent — Prisma agent with tools[]
 * @param {string} params.initiatedByUserId
 */
async function runAgentV2({ assistant, message, knowledgeBlock, model, agent, initiatedByUserId, fsmStage, context }) {
  const userMsg = message == null ? "" : String(message).trim();
  const kb = knowledgeBlock ? String(knowledgeBlock).trim() : "";
  const rules =
    agent.rules && String(agent.rules).trim() !== ""
      ? String(agent.rules).trim()
      : "You are a multi-step agent. Use tools when needed, then respond with a final answer. Respond ONLY with one JSON object per turn.";

  const toolsBlock = formatToolsBlock(agent.tools || []);

  const tExec0 = Date.now();
  /** @type {number[]} */
  const stepLatencyMs = [];
  /** @type {number[]} */
  const toolLatencyMs = [];

  const execution = await prisma.agentExecution.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      initiatedByUserId,
      status: "running",
      input: userMsg,
    },
  });

  console.log("agent v2 execution", execution.id);

  let seq = 0;
  /** @type {string[]} */
  const toolHistory = [];
  let finalText = "";
  let finished = false;
  /** @type {string | null} */
  let prevSig = null;
  let lastToolIdExecuted = null;
  let toolCallsCount = 0;
  const maxToolCalls = getMaxToolCalls();
  let contextTruncatedFlag = false;

  const persistStep = async (type, status, payload) => {
    await prisma.agentStep.create({
      data: {
        organizationId: agent.organizationId,
        executionId: execution.id,
        stepIndex: seq,
        type,
        status,
        payload: payload === undefined ? undefined : payload,
      },
    });
    seq += 1;
  };

  try {
    for (let i = 0; i < MAX_LOOPS; i++) {
      if (Date.now() - tExec0 > getExecutionTimeoutMs()) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "Execution time limit reached. Answer briefly from KNOWLEDGE.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "execution_timeout", text: finalText });
        finished = true;
        break;
      }

      const ctxMax = getGlobalContextMax();
      const { lines: linesForPrompt, truncated: historyTrimmed } = trimHistoryForBudget(
        rules,
        toolsBlock,
        kb,
        userMsg,
        assistant,
        toolHistory,
        ctxMax,
        fsmStage,
        context
      );
      if (historyTrimmed) {
        contextTruncatedFlag = true;
      }

      const prompt = buildPlannerPrompt(rules, toolsBlock, kb, userMsg, assistant, linesForPrompt, fsmStage, context);

      const tStep0 = Date.now();
      const raw = await ollamaGenerate(model, prompt);
      stepLatencyMs.push(Date.now() - tStep0);

      const parsed = parseAgentJson(raw);
      const vd =
        parsed && typeof parsed === "object" ? validateDecision(parsed) : { valid: false, reason: "parse" };

      await persistStep("decision", vd.valid ? "success" : "failed", {
        loopIndex: i,
        raw: raw.slice(0, 12000),
        parsed: parsed && typeof parsed === "object" ? parsed : null,
        validation: vd.valid ? undefined : vd.reason,
      });

      console.log({
        executionId: execution.id,
        stepIndex: seq - 1,
        loopIndex: i,
        action: parsed && typeof parsed === "object" ? parsed.action : null,
        tool: parsed && typeof parsed === "object" ? parsed.toolId : null,
      });

      if (!parsed || typeof parsed !== "object" || !vd.valid || !vd.normalized) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          !parsed || typeof parsed !== "object"
            ? "The planner output was not valid JSON. Answer the user helpfully from KNOWLEDGE and context."
            : `Invalid decision (${vd.reason || "unknown"}). Answer the user directly without tools.`,
          fsmStage,
          context
        );
        await persistStep("response", "failed", {
          reason: !parsed || typeof parsed !== "object" ? "parse_fallback" : "validation_fallback",
          validation: vd.reason,
          text: finalText,
        });
        finished = true;
        break;
      }

      const norm = vd.normalized;
      const sig = decisionSignature(parsed);
      if (prevSig !== null && prevSig === sig && i > 0) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "The same decision repeated. Stop looping and answer the user in plain text.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "stagnation", text: finalText });
        finished = true;
        break;
      }
      prevSig = sig;

      if (norm.action === "final") {
        finalText = norm.text != null ? String(norm.text) : "";
        await persistStep("response", "success", { text: finalText });
        finished = true;
        break;
      }

      const toolId = norm.toolId;
      const tool = (agent.tools || []).find((x) => x.id === toolId);

      if (!tool) {
        await persistStep("tool", "failed", { toolId, error: "not_found" });
        toolHistory.push(
          buildStructuredToolResult(
            toolId,
            JSON.stringify({ ok: false, error: "tool_not_found" }),
            false
          )
        );
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "Requested tool was not found. Answer without it.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "missing_tool", text: finalText });
        finished = true;
        break;
      }

      if (toolId === lastToolIdExecuted) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "The same tool was selected twice in a row. Summarize and answer the user.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "repeat_tool_guard", text: finalText });
        finished = true;
        break;
      }

      if (toolCallsCount >= maxToolCalls) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "Maximum number of tool calls reached. Answer from KNOWLEDGE only.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "tool_limit_reached", text: finalText });
        finished = true;
        break;
      }

      if (Date.now() - tExec0 > getExecutionTimeoutMs()) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "Execution time limit reached before running the tool. Answer from KNOWLEDGE.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "execution_timeout", text: finalText });
        finished = true;
        break;
      }

      const tTool0 = Date.now();
      let toolResult = "";
      try {
        toolResult = await executeTool(tool, norm.input);
      } catch (e) {
        toolResult = JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      toolLatencyMs.push(Date.now() - tTool0);
      toolCallsCount += 1;

      const failed = toolExecutionLooksFailed(toolResult);
      await persistStep("tool", failed ? "failed" : "success", {
        toolId,
        result: toolResult.slice(0, 8000),
        failed,
      });

      console.log({
        executionId: execution.id,
        stepIndex: seq - 1,
        loopIndex: i,
        action: "tool",
        tool: toolId,
      });

      lastToolIdExecuted = toolId;

      toolHistory.push(
        buildStructuredToolResult(toolId, toolResult, !failed)
      );

      if (failed) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "A tool did not return a useful result. Answer using KNOWLEDGE and context only.",
          fsmStage,
          context
        );
        await persistStep("response", "failed", { reason: "tool_not_useful", text: finalText });
        finished = true;
        break;
      }
    }

    if (!finished) {
      const tFb = Date.now();
      if (Date.now() - tExec0 > getExecutionTimeoutMs()) {
        finalText = await llmFallbackPlain(
          model,
          rules,
          kb,
          userMsg,
          assistant,
          "Step limit reached under time pressure. Summarize from KNOWLEDGE.",
          fsmStage,
          context
        );
      } else {
        finalText = await ollamaGenerate(
          model,
          buildMaxStepsFallbackPrompt(rules, kb, userMsg, assistant, fsmStage, context)
        );
      }
      stepLatencyMs.push(Date.now() - tFb);
      await persistStep("response", "failed", { reason: "max_loops_fallback", text: finalText });
    }

    const totalExecutionMs = Date.now() - tExec0;
    const metrics = {
      totalExecutionMs,
      stepLatencyMs,
      toolLatencyMs,
      toolCallsCount,
      maxToolCalls,
      contextTruncated: contextTruncatedFlag,
      globalContextMaxChars: getGlobalContextMax(),
      executionTimeoutMs: getExecutionTimeoutMs(),
    };

    console.log({
      executionId: execution.id,
      ...metrics,
    });

    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "done",
        output: finalText,
        metrics,
      },
    });

    return { reply: finalText, model };
  } catch (err) {
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "failed",
        output: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

module.exports = {
  runAgentV2,
  MAX_LOOPS,
  validateDecision,
  getToolContextMax,
  getGlobalContextMax,
  getExecutionTimeoutMs,
  getMaxToolCalls,
};
