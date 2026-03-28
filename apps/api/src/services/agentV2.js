"use strict";

const prisma = require("../lib/prisma");
const { executeTool } = require("./tools");

const MAX_LOOPS = 5;
const VALID_ACTIONS = new Set(["tool", "final"]);

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
 * @param {string} rules
 * @param {string} kb
 * @param {string} userMsg
 * @param {string} assistantName
 */
function buildMaxStepsFallbackPrompt(rules, kb, userMsg, assistantName) {
  return `SYSTEM (agent rules):
${rules}

KNOWLEDGE:
${kb || "(none)"}

ASSISTANT: ${assistantName}

USER:
${userMsg}

The agent reached the maximum number of steps without a final answer. Summarize what you know and answer the user helpfully in plain text. Do not output JSON.`;
}

/**
 * Multi-step agent (max 5 LLM rounds): decision → tool(s) → final.
 * @param {object} params
 * @param {object} params.assistant
 * @param {unknown} params.message
 * @param {string} params.knowledgeBlock
 * @param {string} params.model
 * @param {object} params.agent — Prisma agent with tools[]
 */
async function runAgentV2({ assistant, message, knowledgeBlock, model, agent }) {
  const userMsg = message == null ? "" : String(message).trim();
  const kb = knowledgeBlock ? String(knowledgeBlock).trim() : "";
  const rules =
    agent.rules && String(agent.rules).trim() !== ""
      ? String(agent.rules).trim()
      : "You are a multi-step agent. Use tools when needed, then respond with a final answer. Respond ONLY with one JSON object per turn.";

  const toolsBlock = formatToolsBlock(agent.tools || []);

  const execution = await prisma.agentExecution.create({
    data: {
      agentId: agent.id,
      userId: agent.userId,
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

  const persistStep = async (type, payload) => {
    await prisma.agentStep.create({
      data: {
        executionId: execution.id,
        stepIndex: seq,
        type,
        payload: payload === undefined ? undefined : payload,
      },
    });
    seq += 1;
  };

  try {
    for (let i = 0; i < MAX_LOOPS; i++) {
      const historyBlock =
        toolHistory.length === 0 ? "(none yet)" : toolHistory.map((h, idx) => `[${idx + 1}] ${h}`).join("\n\n");

      const prompt = `SYSTEM (agent rules):
${rules}

TOOLS (available):
${toolsBlock}

KNOWLEDGE:
${kb || "(none)"}

ASSISTANT: ${assistant.name}

USER:
${userMsg}

PREVIOUS TOOL RESULTS:
${historyBlock}

Respond with exactly one JSON object:
{"action":"final","text":"<answer to user>"}
OR
{"action":"tool","toolId":"<uuid>","input":<optional object>}`;

      const raw = await ollamaGenerate(model, prompt);
      const parsed = parseAgentJson(raw);

      await persistStep("decision", {
        loopIndex: i,
        raw: raw.slice(0, 12000),
        parsed: parsed && typeof parsed === "object" ? parsed : null,
      });

      console.log({
        executionId: execution.id,
        stepIndex: seq - 1,
        loopIndex: i,
        action: parsed && typeof parsed === "object" ? parsed.action : null,
        tool: parsed && typeof parsed === "object" ? parsed.toolId : null,
      });

      if (!parsed || typeof parsed !== "object") {
        finalText = raw.trim() || "I could not parse the next step.";
        await persistStep("response", { reason: "parse_fallback", text: finalText });
        finished = true;
        break;
      }

      const action = parsed.action != null ? String(parsed.action).trim() : "";

      if (!VALID_ACTIONS.has(action)) {
        finalText = parsed.text != null ? String(parsed.text) : raw;
        await persistStep("response", { reason: "invalid_action_fallback", text: finalText });
        finished = true;
        break;
      }

      if (action === "final") {
        finalText = parsed.text != null ? String(parsed.text) : raw;
        await persistStep("response", { text: finalText });
        finished = true;
        break;
      }

      const toolId = parsed.toolId != null ? String(parsed.toolId) : "";
      const tool = (agent.tools || []).find((x) => x.id === toolId);

      if (!tool) {
        toolHistory.push(`ERROR: tool not found for id=${toolId}`);
        await persistStep("tool", { toolId, error: "not_found" });
        continue;
      }

      let toolResult = "";
      try {
        toolResult = await executeTool(tool, parsed.input);
      } catch (e) {
        toolResult = JSON.stringify({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      await persistStep("tool", {
        toolId,
        result: toolResult.slice(0, 8000),
        failed: toolExecutionLooksFailed(toolResult),
      });

      console.log({
        executionId: execution.id,
        stepIndex: seq - 1,
        loopIndex: i,
        action: "tool",
        tool: toolId,
      });

      if (toolExecutionLooksFailed(toolResult)) {
        toolHistory.push(`TOOL ${toolId} FAILED: ${toolResult.slice(0, 2000)}`);
      } else {
        toolHistory.push(`TOOL ${toolId} OK: ${toolResult.slice(0, 2000)}`);
      }
    }

    if (!finished) {
      finalText = await ollamaGenerate(model, buildMaxStepsFallbackPrompt(rules, kb, userMsg, assistant.name));
      await persistStep("response", { reason: "max_loops_fallback", text: finalText });
    }

    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "done",
        output: finalText,
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
};
