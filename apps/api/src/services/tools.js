"use strict";

const DEFAULT_TOOL_MS = 3000;
const TOOL_RESULT_MAX_CHARS = 2000;

function getToolTimeoutMs() {
  const n = parseInt(process.env.AGENT_TOOL_TIMEOUT_MS || String(DEFAULT_TOOL_MS), 10);
  return Number.isNaN(n) || n < 1 ? DEFAULT_TOOL_MS : n;
}

/**
 * Execute tool by type. HTTP: config.url, optional method, headers, body template.
 * @param {{ id: string; type: string; config: unknown }} tool
 * @param {unknown} input
 * @returns {Promise<string>} Text/JSON string for LLM follow-up (max ~TOOL_RESULT_MAX_CHARS in body)
 */
async function executeTool(tool, input) {
  const type = String(tool.type || "").toLowerCase();
  if (type === "http") {
    return executeHttpTool(tool.config, input);
  }
  return JSON.stringify({ error: "unsupported_tool_type", type: tool.type, ok: false });
}

/**
 * @param {string} text
 */
function limitToolResultBody(text) {
  const t = String(text);
  if (t.length <= TOOL_RESULT_MAX_CHARS) {
    return t;
  }
  return `${t.slice(0, TOOL_RESULT_MAX_CHARS)}…`;
}

/**
 * @param {unknown} config
 * @param {unknown} input
 */
async function executeHttpTool(config, input) {
  const c = config && typeof config === "object" ? config : {};
  const url = c.url != null ? String(c.url) : "";
  if (!url) {
    return JSON.stringify({ error: "missing_config_url", ok: false });
  }
  const method = (c.method != null ? String(c.method) : "GET").toUpperCase();
  const headers = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    ...(typeof c.headers === "object" && c.headers !== null ? c.headers : {}),
  };

  const controller = new AbortController();
  const timeoutMs = getToolTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const init = { method, headers, redirect: "follow", signal: controller.signal };

  if (method !== "GET" && method !== "HEAD") {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    init.body = input != null ? JSON.stringify(input) : c.body != null ? JSON.stringify(c.body) : undefined;
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const body = limitToolResultBody(text);
    const out = {
      ok: res.ok,
      status: res.status,
      body,
    };
    return JSON.stringify(out);
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? e.name : "";
    const isAbort = name === "AbortError";
    return JSON.stringify({
      ok: false,
      error: isAbort ? "tool_fetch_timeout" : e instanceof Error ? e.message : String(e),
      status: 0,
      body: "",
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  executeTool,
  executeHttpTool,
  TOOL_RESULT_MAX_CHARS,
};
