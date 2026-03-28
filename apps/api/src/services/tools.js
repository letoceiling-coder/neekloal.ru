"use strict";

/**
 * Execute tool by type. HTTP: config.url, optional method, headers, body template.
 * @param {{ id: string; type: string; config: unknown }} tool
 * @param {unknown} input
 * @returns {Promise<string>} Text/JSON string for LLM follow-up
 */
async function executeTool(tool, input) {
  const type = String(tool.type || "").toLowerCase();
  if (type === "http") {
    return executeHttpTool(tool.config, input);
  }
  return JSON.stringify({ error: "unsupported_tool_type", type: tool.type });
}

/**
 * @param {unknown} config
 * @param {unknown} input
 */
async function executeHttpTool(config, input) {
  const c = config && typeof config === "object" ? config : {};
  const url = c.url != null ? String(c.url) : "";
  if (!url) {
    return JSON.stringify({ error: "missing_config_url" });
  }
  const method = (c.method != null ? String(c.method) : "GET").toUpperCase();
  const headers = {
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    ...(typeof c.headers === "object" && c.headers !== null ? c.headers : {}),
  };

  const init = { method, headers, redirect: "follow" };

  if (method !== "GET" && method !== "HEAD") {
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    init.body = input != null ? JSON.stringify(input) : c.body != null ? JSON.stringify(c.body) : undefined;
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    const out = {
      ok: res.ok,
      status: res.status,
      body: text.length > 8000 ? `${text.slice(0, 8000)}…` : text,
    };
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

module.exports = {
  executeTool,
  executeHttpTool,
};
