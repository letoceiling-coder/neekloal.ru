"use strict";

const prisma = require("../lib/prisma");
const { generateTextWithUsage } = require("./aiService");
const { executeEngineTool, ALLOWED_TOOLS } = require("./agentEngineTools");
const { recordAgentExecutionUsage } = require("./usageService");

const MAX_LOOPS = 5;
const EXECUTION_TIMEOUT_MS = 10000;
const TOOL_OUTPUT_MAX_LEN = 1000;
const MEMORY_LOAD_MESSAGES = 10;
const CONTEXT_MAX_MESSAGES = 12;
const MAX_TOOL_CALLS_PER_EXECUTION = 3;

/**
 * @param {unknown} value
 * @param {number} [max]
 */
function truncate(value, max = TOOL_OUTPUT_MAX_LEN) {
  let str;
  try {
    if (typeof value === "string") {
      str = value;
    } else {
      const j = JSON.stringify(value);
      str = j === undefined ? String(value) : j;
    }
  } catch {
    str = "[unserializable]";
  }
  return str.length > max ? str.slice(0, max) + "..." : str;
}

/**
 * Единый формат ошибок движка.
 * @param {string} reason
 * @param {string | null} [detail]
 */
function normalizedEngineError(reason, detail = null) {
  return {
    code: "AGENT_ENGINE_ERROR",
    reason,
    detail: detail == null ? null : String(detail),
  };
}

/**
 * @param {string} raw
 * @returns {unknown}
 */
function parseJsonFromLlm(raw) {
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

function buildSystemPrompt() {
  return `Ты агент. Отвечай строго одним JSON-объектом, без markdown и без текста вокруг.

Ниже в блоке «Контекст» — история диалога (роли user / assistant / tool) и текущая реплика пользователя. Учитывай её при выборе инструментов и ответа.

Правила безопасности и поведения:
- Не придумывай инструменты и не используй имена tool вне списка ниже. Разрешены только: search, calculator, http_request.
- Если не уверен, что tool нужен или какой именно, верни {"action":"final","text":"..."} и ответь пользователю честно, без вызова tool.

Доступные инструменты:
- "search": input — строка запроса (mock-поиск).
- "calculator": input — строка с выражением: цифры, пробелы, + - * / ( ).
- "http_request": input — полный URL; выполняется только GET; только http/https (без localhost и внутренних сетей).

Верни ровно один из вариантов:
{"action":"tool","tool":"search","input":"<строка>"}
{"action":"tool","tool":"calculator","input":"<строка>"}
{"action":"tool","tool":"http_request","input":"<url>"}
{"action":"final","text":"<ответ пользователю>"}`;
}

/**
 * STEP 2: whitelist + тип input (только string).
 * @param {string} toolName
 * @param {unknown} input
 */
function validateToolCall(toolName, input) {
  const t = String(toolName || "").trim().toLowerCase();
  if (!ALLOWED_TOOLS.has(t)) {
    return {
      ok: false,
      error: normalizedEngineError("tool_not_whitelisted", toolName),
    };
  }
  if (typeof input !== "string") {
    return {
      ok: false,
      error: normalizedEngineError("invalid_tool_input", `tool "${t}" expects string input`),
    };
  }
  return { ok: true, tool: t, input };
}

/**
 * @param {import('@prisma/client').AgentStep} row
 */
function stepToClient(row) {
  const p = row.payload && typeof row.payload === "object" ? row.payload : {};
  const base = { id: row.id, type: row.type };

  if (row.type === "thinking") {
    if (p.llmRaw != null) {
      return { ...base, content: String(p.llmRaw) };
    }
    if (p.content != null) {
      return { ...base, content: String(p.content) };
    }
    return { ...base, content: JSON.stringify(p) };
  }

  if (row.type === "tool") {
    let out = p.output;
    if (typeof out === "string") {
      try {
        out = JSON.parse(out);
      } catch {
        /* keep string */
      }
    }
    return {
      ...base,
      toolName: p.toolName != null ? String(p.toolName) : undefined,
      input: p.input,
      output: out,
    };
  }

  if (row.type === "response") {
    if (p.code != null && p.reason != null) {
      const err = {
        code: String(p.code),
        reason: String(p.reason),
        detail: p.detail != null ? String(p.detail) : null,
      };
      return {
        ...base,
        content: err.reason,
        output: { error: err },
      };
    }
    if (p.error != null) {
      return { ...base, content: String(p.error), output: { error: p.error } };
    }
    const text = p.text != null ? String(p.text) : "";
    return { ...base, content: text, output: text };
  }

  return { ...base, content: JSON.stringify(p) };
}

/**
 * @param {object} params
 * @param {string} params.organizationId
 * @param {string} params.userId
 * @param {string} params.agentId
 * @param {string} params.message
 * @param {string} [params.conversationId]
 * @returns {Promise<{ executionId: string; output: string | null; steps: object[] }>}
 */
async function runAgentEngine(params) {
  const { organizationId, userId, agentId, message, conversationId } = params;
  const msg = String(message ?? "").trim();
  if (!msg) {
    throw new Error("EMPTY_MESSAGE");
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, organizationId, deletedAt: null },
    include: { tools: true },
  });
  if (!agent) {
    throw new Error("AGENT_NOT_FOUND");
  }

  const assistant = agent.assistantId
    ? await prisma.assistant.findFirst({
        where: { id: agent.assistantId, organizationId, deletedAt: null },
      })
    : null;
  if (!assistant) {
    throw new Error("ASSISTANT_REQUIRED");
  }

  const model = assistant.model;

  /** @type {import('@prisma/client').Message[]} */
  let priorDbMessages = [];
  const convId =
    conversationId != null && String(conversationId).trim() !== ""
      ? String(conversationId).trim()
      : null;
  if (convId) {
    const conv = await prisma.conversation.findFirst({
      where: { id: convId, organizationId, deletedAt: null },
    });
    if (!conv) {
      throw new Error("CONVERSATION_NOT_FOUND");
    }
    if (conv.agentId != null && conv.agentId !== agentId) {
      throw new Error("CONVERSATION_AGENT_MISMATCH");
    }
    const lastBatch = await prisma.message.findMany({
      where: { conversationId: convId, organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: MEMORY_LOAD_MESSAGES,
    });
    priorDbMessages = lastBatch.slice().reverse();
  }

  const executionStartedAt = Date.now();
  const execution = await prisma.agentExecution.create({
    data: {
      organizationId,
      agentId,
      initiatedByUserId: userId,
      status: "running",
      input: msg,
    },
  });

  let stepIndex = 0;
  let toolCallsSoFar = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  /** @type {object[]} */
  const clientSteps = [];

  function buildExecutionMetricsPatch() {
    return {
      stepsCount: stepIndex,
      toolCalls: toolCallsSoFar,
      durationMs: Date.now() - executionStartedAt,
      totalTokens: totalPromptTokens + totalCompletionTokens,
      metrics: {
        llmPromptTokens: totalPromptTokens,
        llmCompletionTokens: totalCompletionTokens,
      },
    };
  }

  async function hookBilling() {
    try {
      const r = await recordAgentExecutionUsage({
        organizationId,
        userId,
        assistantId: assistant.id,
        conversationId: convId,
        model,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
      });
      if (!r.ok) {
        console.warn("[agentEngine] usage not recorded:", r.error);
      }
    } catch (e) {
      console.error("[agentEngine] usage hook failed:", e);
    }
  }

  /**
   * @param {string} type
   * @param {string} status
   * @param {unknown} payload
   */
  async function persistStep(type, status, payload) {
    const row = await prisma.agentStep.create({
      data: {
        organizationId,
        executionId: execution.id,
        stepIndex: stepIndex++,
        type,
        status,
        payload: payload === undefined ? undefined : payload,
      },
    });
    clientSteps.push(stepToClient(row));
    return row;
  }

  await persistStep("thinking", "completed", {
    phase: "user_message",
    content: msg,
  });

  /** История: загруженная память + текущий user; обрезка с начала при переполнении */
  /** @type {{ role: string; content: string }[]} */
  let messages = [];
  for (const row of priorDbMessages) {
    const rawRole = String(row.role || "user").toLowerCase().trim();
    const role = ["user", "assistant", "tool"].includes(rawRole) ? rawRole : "user";
    messages.push({ role, content: String(row.content ?? "") });
  }
  const lastLoaded = messages.length > 0 ? messages[messages.length - 1] : null;
  if (
    !lastLoaded ||
    lastLoaded.role !== "user" ||
    lastLoaded.content.trim() !== msg.trim()
  ) {
    messages.push({ role: "user", content: msg });
  }

  function trimMessagesToMax() {
    while (messages.length > CONTEXT_MAX_MESSAGES) {
      messages.splice(0, 1);
    }
  }
  trimMessagesToMax();

  function pushMessage(role, content) {
    messages.push({ role, content: String(content) });
    while (messages.length > CONTEXT_MAX_MESSAGES) {
      messages.splice(0, 1);
    }
  }

  function contextString() {
    return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  }

  /** STEP 4: wall-clock лимит выполнения */
  const startedAt = Date.now();

  /** один и тот же tool подряд */
  let lastToolForLoop = null;
  let sameToolStreak = 0;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    if (Date.now() - startedAt > EXECUTION_TIMEOUT_MS) {
      const errPayload = normalizedEngineError("timeout_exceeded");
      await persistStep("response", "failed", errPayload);
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: JSON.stringify(errPayload),
          statusReason: "timeout",
          ...buildExecutionMetricsPatch(),
        },
      });
      await hookBilling();
      return { executionId: execution.id, output: null, steps: clientSteps };
    }

    const prompt = `${buildSystemPrompt()}\n\nКонтекст:\n${contextString()}\n\nОтветь только JSON.`;

    let raw = "";
    for (let netTry = 0; netTry < 2; netTry++) {
      try {
        const gen = await generateTextWithUsage(model, prompt);
        raw = gen.text;
        totalPromptTokens += gen.promptTokens;
        totalCompletionTokens += gen.completionTokens;
        break;
      } catch (e) {
        if (netTry === 1) {
          const errPayload = normalizedEngineError(
            "llm_request_failed",
            e instanceof Error ? e.message : String(e),
          );
          await persistStep("response", "failed", errPayload);
          await prisma.agentExecution.update({
            where: { id: execution.id },
            data: {
              status: "failed",
              output: JSON.stringify(errPayload),
              statusReason: "network_error",
              ...buildExecutionMetricsPatch(),
            },
          });
          await hookBilling();
          return { executionId: execution.id, output: null, steps: clientSteps };
        }
      }
    }

    let parsed = parseJsonFromLlm(raw);
    if (!parsed || typeof parsed !== "object") {
      try {
        const gen = await generateTextWithUsage(model, prompt);
        raw = gen.text;
        totalPromptTokens += gen.promptTokens;
        totalCompletionTokens += gen.completionTokens;
        parsed = parseJsonFromLlm(raw);
      } catch (e) {
        const errPayload = normalizedEngineError(
          "llm_request_failed",
          e instanceof Error ? e.message : String(e),
        );
        await persistStep("response", "failed", errPayload);
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "failed",
            output: JSON.stringify(errPayload),
            statusReason: "network_error",
            ...buildExecutionMetricsPatch(),
          },
        });
        await hookBilling();
        return { executionId: execution.id, output: null, steps: clientSteps };
      }
    }

    if (!parsed || typeof parsed !== "object") {
      const errPayload = normalizedEngineError("invalid_llm_json");
      await persistStep("response", "failed", errPayload);
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: JSON.stringify(errPayload),
          statusReason: "invalid_json",
          ...buildExecutionMetricsPatch(),
        },
      });
      await hookBilling();
      return { executionId: execution.id, output: null, steps: clientSteps };
    }

    await persistStep("thinking", "completed", { llmRaw: raw });

    pushMessage("assistant", raw);

    const action =
      "action" in parsed && parsed.action != null ? String(parsed.action).trim() : "";

    if (action === "final") {
      const hasText = "text" in parsed && parsed.text != null;
      const text = hasText ? String(parsed.text) : "";
      const finalLen = text.trim().length;
      if (!hasText || finalLen < 2) {
        const errPayload = normalizedEngineError(
          "invalid_final",
          hasText ? `length=${finalLen}` : "missing_text",
        );
        await persistStep("response", "failed", errPayload);
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "failed",
            output: JSON.stringify(errPayload),
            statusReason: "invalid_final",
            ...buildExecutionMetricsPatch(),
          },
        });
        await hookBilling();
        return { executionId: execution.id, output: null, steps: clientSteps };
      }
      await persistStep("response", "completed", { text });
      await prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "completed",
          output: text,
          statusReason: "success",
          ...buildExecutionMetricsPatch(),
        },
      });
      await hookBilling();
      return { executionId: execution.id, output: text, steps: clientSteps };
    }

    if (action === "tool") {
      const toolRaw =
        "tool" in parsed && parsed.tool != null ? String(parsed.tool).trim() : "";
      const input = "input" in parsed ? parsed.input : "";

      const v = validateToolCall(toolRaw, input);
      if (!v.ok) {
        await persistStep("response", "failed", v.error);
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "failed",
            output: JSON.stringify(v.error),
            statusReason: "tool_validation_failed",
            ...buildExecutionMetricsPatch(),
          },
        });
        await hookBilling();
        return { executionId: execution.id, output: null, steps: clientSteps };
      }

      if (toolCallsSoFar >= MAX_TOOL_CALLS_PER_EXECUTION) {
        const errPayload = normalizedEngineError(
          "tool_limit_exceeded",
          String(MAX_TOOL_CALLS_PER_EXECUTION),
        );
        await persistStep("response", "failed", errPayload);
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "failed",
            output: JSON.stringify(errPayload),
            statusReason: "tool_limit_exceeded",
            ...buildExecutionMetricsPatch(),
          },
        });
        await hookBilling();
        return { executionId: execution.id, output: null, steps: clientSteps };
      }

      console.log("AGENT TOOL EXEC:", { tool: v.tool, input: v.input });

      let toolOutFull;
      try {
        toolOutFull = await executeEngineTool(v.tool, v.input);
      } catch (e) {
        toolOutFull = JSON.stringify({
          ok: false,
          data: { error: "tool_threw", detail: e instanceof Error ? e.message : String(e) },
          status: "error",
        });
      }

      console.log("AGENT TOOL RESULT:", { tool: v.tool, output: toolOutFull });

      const toolOut = truncate(toolOutFull, TOOL_OUTPUT_MAX_LEN);
      await persistStep("tool", "completed", {
        toolName: v.tool,
        input: v.input,
        output: toolOut,
      });
      toolCallsSoFar += 1;
      pushMessage("tool", toolOut);

      /** STEP 6: три подряд один и тот же tool — стоп после третьего выполнения */
      if (v.tool === lastToolForLoop) {
        sameToolStreak += 1;
      } else {
        sameToolStreak = 1;
        lastToolForLoop = v.tool;
      }
      if (sameToolStreak >= 3) {
        const errPayload = normalizedEngineError("tool_loop_limit", v.tool);
        await persistStep("response", "failed", errPayload);
        await prisma.agentExecution.update({
          where: { id: execution.id },
          data: {
            status: "failed",
            output: JSON.stringify(errPayload),
            statusReason: "tool_loop_limit",
            ...buildExecutionMetricsPatch(),
          },
        });
        await hookBilling();
        return { executionId: execution.id, output: null, steps: clientSteps };
      }
      continue;
    }

    const errPayload = normalizedEngineError("invalid_action", action || null);
    await persistStep("response", "failed", errPayload);
    await prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "failed",
        output: JSON.stringify(errPayload),
        statusReason: "invalid_action",
        ...buildExecutionMetricsPatch(),
      },
    });
    await hookBilling();
    return { executionId: execution.id, output: null, steps: clientSteps };
  }

  const errPayload = normalizedEngineError("max_steps_reached");
  await persistStep("response", "failed", errPayload);
  await prisma.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: "failed",
      output: JSON.stringify(errPayload),
      statusReason: "max_steps_reached",
      ...buildExecutionMetricsPatch(),
    },
  });
  await hookBilling();
  return { executionId: execution.id, output: null, steps: clientSteps };
}

module.exports = {
  runAgentEngine,
  MAX_LOOPS,
  MAX_TOOL_CALLS_PER_EXECUTION,
  normalizedEngineError,
  parseJsonFromLlm,
  validateToolCall,
  buildSystemPrompt,
  truncate,
};
