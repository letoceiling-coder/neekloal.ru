"use strict";

const http = require("http");
const https = require("https");
const net = require("net");
const dns = require("dns").promises;
const { URL } = require("url");

const HTTP_TOOL_TIMEOUT_MS = 8000;
const HTTP_MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Единый JSON-ответ инструмента: { ok, data, status }.
 * @param {boolean} ok
 * @param {unknown} data
 * @param {string | number} status
 */
function packTool(ok, data, status) {
  return JSON.stringify({ ok, data, status });
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIPv4(ip) {
  const parts = ip.split(".").map((x) => parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 127) {
    return true;
  }
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIPv6(ip) {
  const s = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const mapped = s.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})/i);
  if (mapped) {
    return isBlockedIPv4(mapped[1]);
  }
  if (s === "::1" || s === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (/^fe[89ab]/i.test(s)) {
    return true;
  }
  if (/^fc[0-9a-f]{2}:/i.test(s) || /^fd[0-9a-f]{2}:/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    return isBlockedIPv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isBlockedIPv6(ip);
  }
  return true;
}

/**
 * Блокировка localhost / частных сетей (SSRF).
 * @param {URL} u
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function assertUrlSafeForSsrf(u) {
  const host = u.hostname;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    return { ok: false, error: "blocked_host_localhost" };
  }
  if (lower === "0.0.0.0") {
    return { ok: false, error: "blocked_host" };
  }
  if (net.isIPv4(host) || net.isIPv6(host)) {
    if (isBlockedIp(host)) {
      return { ok: false, error: "blocked_ip_literal" };
    }
    return { ok: true };
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, error: "dns_failed" };
  }
  if (!records || records.length === 0) {
    return { ok: false, error: "dns_empty" };
  }
  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      return { ok: false, error: "blocked_resolved_ip" };
    }
  }
  return { ok: true };
}

/**
 * @param {string} query
 * @returns {Promise<string>} JSON string
 */
async function search(query) {
  const q = String(query ?? "").trim() || "(empty)";
  return packTool(
    true,
    {
      tool: "search",
      results: [`[mock] result A for "${q}"`, `[mock] result B for "${q}"`],
    },
    "ok",
  );
}

/**
 * Безопасный разбор арифметики: только цифры, ., +, -, *, /, скобки.
 * @param {string} expr
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
function calcSafe(expr) {
  const raw = String(expr ?? "").trim();
  if (!raw) {
    return { ok: false, error: "empty_expression" };
  }
  if (!/^[-+*/().\d\s]+$/.test(raw)) {
    return { ok: false, error: "invalid_characters" };
  }
  const s = raw.replace(/\s+/g, "");
  let pos = 0;

  function peek() {
    return pos < s.length ? s[pos] : "";
  }

  function eat(ch) {
    if (peek() === ch) {
      pos++;
      return true;
    }
    return false;
  }

  function parseNumber() {
    const start = pos;
    while (pos < s.length && /[\d.]/.test(s[pos])) {
      pos++;
    }
    if (start === pos) {
      return NaN;
    }
    const n = parseFloat(s.slice(start, pos));
    return Number.isFinite(n) ? n : NaN;
  }

  function parseFactor() {
    if (eat("-")) {
      const v = parseFactor();
      return Number.isFinite(v) ? -v : NaN;
    }
    if (eat("(")) {
      const v = parseExpr();
      if (!eat(")")) {
        return NaN;
      }
      return v;
    }
    return parseNumber();
  }

  function parseTerm() {
    let v = parseFactor();
    if (!Number.isFinite(v)) {
      return NaN;
    }
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      pos++;
      const r = parseFactor();
      if (!Number.isFinite(r)) {
        return NaN;
      }
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function parseExpr() {
    let v = parseTerm();
    if (!Number.isFinite(v)) {
      return NaN;
    }
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      pos++;
      const r = parseTerm();
      if (!Number.isFinite(r)) {
        return NaN;
      }
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = parseExpr();
  if (pos !== s.length || !Number.isFinite(v)) {
    return { ok: false, error: "parse_error" };
  }
  return { ok: true, value: v };
}

/**
 * @param {string} expr
 * @returns {Promise<string>} JSON string
 */
async function calculator(expr) {
  const r = calcSafe(expr);
  if (!r.ok) {
    return packTool(false, { tool: "calculator", error: r.error }, "error");
  }
  return packTool(true, { tool: "calculator", value: r.value }, "ok");
}

/**
 * GET только; timeout; ограничение размера тела; SSRF-фильтр.
 * @param {string} input URL строка
 * @returns {Promise<string>} JSON string
 */
async function http_request(input) {
  const urlStr = String(input ?? "").trim();
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return packTool(false, { tool: "http_request", error: "invalid_url" }, "error");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return packTool(false, { tool: "http_request", error: "only_http_https" }, "error");
  }
  if (u.username || u.password) {
    return packTool(false, { tool: "http_request", error: "url_credentials_not_allowed" }, "error");
  }

  const ssrf = await assertUrlSafeForSsrf(u);
  if (!ssrf.ok) {
    return packTool(false, { tool: "http_request", error: ssrf.error }, "error");
  }

  const lib = u.protocol === "https:" ? https : http;

  return await new Promise((resolve) => {
    let settled = false;
    function settle(payload) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(packTool(payload.ok, payload.data, payload.status));
    }

    const req = lib.request(
      u,
      {
        method: "GET",
        timeout: HTTP_TOOL_TIMEOUT_MS,
        headers: { "user-agent": "neekloal-agent-engine/1.0" },
      },
      (res) => {
        const chunks = [];
        let received = 0;
        let bodyDone = false;

        const finishBody = (payload) => {
          if (bodyDone) {
            return;
          }
          bodyDone = true;
          try {
            res.destroy();
          } catch {
            /* ignore */
          }
          settle(payload);
        };

        res.on("data", (chunk) => {
          if (bodyDone) {
            return;
          }
          received += chunk.length;
          if (received > HTTP_MAX_RESPONSE_BYTES) {
            finishBody({
              ok: false,
              data: {
                tool: "http_request",
                error: "response_too_large",
                maxBytes: HTTP_MAX_RESPONSE_BYTES,
              },
              status: "error",
            });
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          if (bodyDone) {
            return;
          }
          const body = Buffer.concat(chunks).toString("utf8");
          const ct = res.headers["content-type"];
          const code = res.statusCode != null ? res.statusCode : 0;
          finishBody({
            ok: true,
            data: {
              tool: "http_request",
              contentType: ct != null ? String(ct) : null,
              body,
            },
            status: code,
          });
        });

        res.on("error", (err) => {
          finishBody({
            ok: false,
            data: {
              tool: "http_request",
              error: "response_error",
              detail: err instanceof Error ? err.message : String(err),
            },
            status: "error",
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", (err) => {
      settle({
        ok: false,
        data: {
          tool: "http_request",
          error: "request_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        status: "error",
      });
    });

    req.end();
  });
}

/** Реестр встроенных инструментов. */
const TOOL_REGISTRY = {
  search,
  calculator,
  http_request,
};

const ALLOWED_TOOLS = new Set(Object.keys(TOOL_REGISTRY));

/**
 * @param {string} toolName
 * @param {unknown} input
 * @returns {Promise<string>}
 */
async function executeEngineTool(toolName, input) {
  const t = String(toolName || "").toLowerCase().trim();
  const fn = TOOL_REGISTRY[t];
  if (!fn) {
    return packTool(false, { error: "unknown_tool", tool: toolName }, "error");
  }
  const arg =
    t === "search" && typeof input !== "string"
      ? JSON.stringify(input)
      : typeof input === "string"
        ? input
        : String(input);
  return fn(arg);
}

module.exports = {
  executeEngineTool,
  search,
  searchMock: search,
  calculator,
  http_request,
  TOOL_REGISTRY,
  ALLOWED_TOOLS,
  packTool,
  assertUrlSafeForSsrf,
  isBlockedIp,
};
