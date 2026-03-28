"use strict";

const { executeTool } = require("./tools");

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
 * Agent layer: JSON decision → optional tool → final LLM.
 * @param {object} params
 * @param {object} params.assistant — Prisma assistant row
 * @param {unknown} params.message
 * @param {string} params.knowledgeBlock
 * @param {string} params.model
 * @param {object} params.agent — Prisma agent with tools[]
 */
async function runAgent({ assistant, message, knowledgeBlock, model, agent }) {
  console.log("agent used", agent.id);

  const userMsg = message == null ? "" : String(message).trim();
  const kb = knowledgeBlock ? String(knowledgeBlock).trim() : "";
  const rules =
    agent.rules && String(agent.rules).trim() !== ""
      ? String(agent.rules).trim()
      : "You are an autonomous agent. Decide whether to call a tool or answer directly. " +
        "Respond ONLY with a single JSON object, no markdown.";

  const toolsBlock = formatToolsBlock(agent.tools || []);

  const firstPrompt = `SYSTEM (agent rules):
${rules}

TOOLS (available):
${toolsBlock}

KNOWLEDGE:
${kb || "(none)"}

ASSISTANT CONTEXT (name / model hint): ${assistant.name}

USER:
${userMsg}

You must respond with exactly one JSON object and nothing else:
{"action":"reply","text":"<your answer to the user>"}
OR
{"action":"tool","toolId":"<uuid from TOOLS>","input":<optional JSON object for the tool>}`;

  const firstRaw = await ollamaGenerate(model, firstPrompt);
  const parsed = parseAgentJson(firstRaw);

  if (!parsed || typeof parsed !== "object") {
    return { reply: firstRaw.trim() || "(empty model response)", model };
  }

  const action = parsed.action != null ? String(parsed.action) : "";

  if (action !== "tool") {
    const text = parsed.text != null ? String(parsed.text) : firstRaw;
    return { reply: text, model };
  }

  const toolId = parsed.toolId != null ? String(parsed.toolId) : "";
  const tool = (agent.tools || []).find((x) => x.id === toolId);
  if (!tool) {
    const secondPrompt = `SYSTEM (agent rules):
${rules}

KNOWLEDGE:
${kb || "(none)"}

USER:
${userMsg}

The model requested an invalid toolId. Explain briefly that the tool was not found and answer if you can without tools.`;

    const fallback = await ollamaGenerate(model, secondPrompt);
    return { reply: fallback, model };
  }

  console.log("tool called", toolId);

  const toolResult = await executeTool(tool, parsed.input);
  console.log("tool result", toolResult.slice(0, 2000));

  const secondPrompt = `SYSTEM (agent rules):
${rules}

KNOWLEDGE:
${kb || "(none)"}

USER:
${userMsg}

TOOL RESULT:
${toolResult}

Write the final answer for the user in plain language. Be concise. Do not output JSON.`;

  const finalText = await ollamaGenerate(model, secondPrompt);
  return { reply: finalText.trim() || toolResult, model };
}

module.exports = {
  runAgent,
};
