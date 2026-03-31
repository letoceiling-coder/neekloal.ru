"use strict";
require("dotenv").config();

/**
 * Agent Chat V2 — 6 integration tests
 */
const BASE  = "http://127.0.0.1:4000";
const TOKEN = process.env.TEST_TOKEN || "";
if (!TOKEN) { console.error("❌ Set TEST_TOKEN"); process.exit(1); }

const HDR = {
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${TOKEN}`,
};

function check(label, got, expected) {
  const ok = String(got) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}: ${JSON.stringify(got)}`);
  return ok;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HDR,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  // ── Setup: get/create an agent ──────────────────────────────────────────
  console.log("\n=== SETUP: Create test agent ===");
  const { status: aS, data: agentData } = await api("POST", "/agents", {
    name:  "V2 Test Agent",
    type:  "playground",
    mode:  "v1",
    rules: "You are a concise AI assistant. Answer in 1-2 sentences only.",
  });
  const agentId = agentData.id;
  console.log(`  Agent id=${agentId} status=${aS}`);

  // ── TEST 1: Create conversation ─────────────────────────────────────────
  console.log("\n=== TEST 1: Create conversation ===");
  const t1 = await api("POST", "/agents/conversations", { agentId, title: "Test Session" });
  check("status 201",      t1.status,       201);
  check("id exists",       !!t1.data.id,    true);
  check("agentId matches", t1.data.agentId, agentId);
  const convId = t1.data.id;
  console.log(`  convId=${convId}`);

  // ── TEST 2: List conversations ──────────────────────────────────────────
  console.log("\n=== TEST 2: List conversations ===");
  const t2 = await api("GET", `/agents/conversations/${agentId}`);
  check("status 200",      t2.status,                             200);
  check("array returned",  Array.isArray(t2.data.conversations),  true);
  check("conv in list",    t2.data.conversations.some(c => c.id === convId), true);
  console.log(`  conversations count=${t2.data.conversations.length}`);

  // ── TEST 3: Chat V2 (non-streaming, DB persist) ─────────────────────────
  console.log("\n=== TEST 3: Chat V2 non-streaming ===");
  const t3 = await api("POST", "/agents/chat/v2", {
    conversationId: convId,
    message:        "What is the capital of France?",
    model:          "llama3:8b",
    temperature:    0.5,
  });
  check("status 200",          t3.status,                  200);
  check("reply non-empty",     t3.data.reply?.length > 0,  true);
  check("modelUsed=llama3:8b", t3.data.modelUsed,          "llama3:8b");
  check("contextLength=2",     t3.data.contextLength,      2);
  check("conversationId ok",   t3.data.conversationId,     convId);
  console.log(`  [reply] ${JSON.stringify(t3.data.reply).slice(0, 80)}`);
  console.log(`  [model] ${t3.data.modelUsed} | tokens: ${t3.data.tokens?.total}`);

  // ── TEST 4: Context saved to DB (second turn uses history) ──────────────
  console.log("\n=== TEST 4: Context persisted in DB ===");
  const t4 = await api("POST", "/agents/chat/v2", {
    conversationId: convId,
    message:        "What was my previous question about?",
  });
  check("status 200",         t4.status,                  200);
  check("contextLength=4",    t4.data.contextLength,      4); // 2 prev + user + assistant
  check("reply non-empty",    t4.data.reply?.length > 0,  true);
  console.log(`  [reply] ${JSON.stringify(t4.data.reply).slice(0, 80)}`);
  console.log(`  [contextLength] ${t4.data.contextLength}`);

  // ── TEST 5: Streaming endpoint ──────────────────────────────────────────
  console.log("\n=== TEST 5: Streaming (SSE) ===");
  let streamTokens = 0;
  let streamDone   = false;
  let streamModel  = "";
  let streamCtxLen = 0;
  let fullReply    = "";

  const streamRes = await fetch(`${BASE}/agents/chat/stream`, {
    method:  "POST",
    headers: HDR,
    body:    JSON.stringify({
      conversationId: convId,
      message:        "Name one planet in the solar system.",
      model:          "qwen2.5:7b",
      maxTokens:      100,
    }),
  });

  check("stream status 200", streamRes.status, 200);
  const ct = streamRes.headers.get("content-type") || "";
  check("content-type SSE",  ct.includes("text/event-stream"), true);

  const reader  = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = "";

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";

    for (const part of parts) {
      const lines     = part.split("\n");
      let   eventName = "message";
      let   dataLine  = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventName = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
      }
      if (!dataLine) continue;
      try {
        const parsed = JSON.parse(dataLine);
        if (eventName === "token" && parsed.token) {
          streamTokens++;
          fullReply += parsed.token;
        }
        if (eventName === "done") {
          streamDone   = true;
          streamModel  = parsed.modelUsed;
          streamCtxLen = parsed.contextLength;
          break outer;
        }
        if (eventName === "error") {
          console.log("  ⚠ stream error:", parsed.error);
          break outer;
        }
      } catch { /* */ }
    }
  }

  check("tokens received",   streamTokens > 0,  true);
  check("done event fired",  streamDone,         true);
  check("model=qwen2.5:7b",  streamModel,        "qwen2.5:7b");
  check("ctxLen=6",          streamCtxLen,       6); // 4 prev + user + assistant
  console.log(`  [streamTokens] ${streamTokens}`);
  console.log(`  [fullReply] ${JSON.stringify(fullReply).slice(0, 80)}`);

  // ── TEST 6: System prompt override ─────────────────────────────────────
  console.log("\n=== TEST 6: System prompt override ===");
  const t6conv = await api("POST", "/agents/conversations", {
    agentId,
    title: "SP Override Test",
  });
  const sp6id = t6conv.data.id;
  const t6 = await api("POST", "/agents/chat/v2", {
    conversationId: sp6id,
    message:        "What are you?",
    systemPrompt:   "You are UNIT-42, a robot. Always mention your designation.",
    temperature:    0.3,
  });
  check("status 200",      t6.status,                 200);
  check("reply non-empty", t6.data.reply?.length > 0, true);
  console.log(`  [reply] ${JSON.stringify(t6.data.reply).slice(0, 120)}`);

  // ── DB verification ─────────────────────────────────────────────────────
  console.log("\n=== DB: Verify conversation saved ===");
  const detail = await api("GET", `/agents/conversations/detail/${convId}`);
  check("status 200",         detail.status,                     200);
  check("messages is array",  Array.isArray(detail.data.messages), true);
  check("messages >= 6",      detail.data.messages.length >= 6,  true);
  console.log(`  [DB messages] count=${detail.data.messages.length}`);
  console.log(`  [Last 2 roles] ${detail.data.messages.slice(-2).map(m => m.role).join(", ")}`);

  console.log("\n=== ALL 6 TESTS DONE ===");
}

run().catch(console.error).finally(() => process.exit(0));
