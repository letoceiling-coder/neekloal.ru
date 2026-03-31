"use strict";
require("dotenv").config();

/**
 * Agent Chat Playground — 5 integration tests
 * Runs directly on the server against http://127.0.0.1:4000
 *
 * Requires a valid JWT token (env: TEST_TOKEN) and a real agentId (env: TEST_AGENT_ID).
 * If no agent exists, test 0 creates one automatically.
 */

const BASE  = "http://127.0.0.1:4000";
const TOKEN = process.env.TEST_TOKEN || "";

if (!TOKEN) {
  console.error("❌ Set TEST_TOKEN env var");
  process.exit(1);
}

const HEADERS = {
  "Content-Type":  "application/json",
  "Authorization": `Bearer ${TOKEN}`,
};

let agentId = process.env.TEST_AGENT_ID || null;

function check(label, got, expected) {
  const ok = String(got) === String(expected);
  console.log(`  ${ok ? "✅" : "❌"} ${label}: ${JSON.stringify(got)} == ${JSON.stringify(expected)}`);
  return ok;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {

  // ── TEST 0: Create agent (if not provided) ──────────────────────────────
  if (!agentId) {
    console.log("\n=== TEST 0: Create test agent ===");
    const { status, data } = await api("POST", "/agents", {
      name:  "Test Playground Agent",
      type:  "playground",
      mode:  "v1",
      rules: "You are a concise AI assistant for testing. Reply in 1-2 sentences.",
    });
    if (status === 201 || status === 200) {
      agentId = data.id;
      console.log(`  ✅ Agent created: ${agentId}`);
    } else {
      console.log(`  ❌ Create failed: ${status} ${JSON.stringify(data)}`);
      console.log("  Please set TEST_AGENT_ID env var with an existing agent ID");
      process.exit(1);
    }
  }

  console.log(`\n[agentId = ${agentId}]`);

  // ── TEST 1: Send message → get reply ───────────────────────────────────
  console.log("\n=== TEST 1: Send message → get reply ===");
  const t1 = await api("POST", "/agents/chat", {
    agentId,
    messages: [{ role: "user", content: "What is 2+2? Reply with just the number." }],
  });
  check("status 200",       t1.status,          200);
  check("reply exists",     typeof t1.data.reply, "string");
  check("reply non-empty",  t1.data.reply.length > 0, true);
  check("modelUsed exists", typeof t1.data.modelUsed, "string");
  check("contextLength=2",  t1.data.contextLength, 2);
  console.log("  [reply]", JSON.stringify(t1.data.reply).slice(0, 80));
  console.log("  [model]", t1.data.modelUsed, "| tokens:", t1.data.tokens?.total);

  // ── TEST 2: Context persists (follow-up question) ────────────────────────
  console.log("\n=== TEST 2: Context persists ===");
  const t2 = await api("POST", "/agents/chat", {
    agentId,
    messages: [{ role: "user", content: "What was the first question I asked?" }],
  });
  check("status 200",        t2.status,            200);
  check("contextLength=4",   t2.data.contextLength, 4); // 2 prev + 1 user + 1 assistant
  check("reply non-empty",   t2.data.reply.length > 0, true);
  console.log("  [reply]", JSON.stringify(t2.data.reply).slice(0, 80));
  console.log("  [contextLength]", t2.data.contextLength);

  // ── TEST 3: Reset clears context ─────────────────────────────────────────
  console.log("\n=== TEST 3: Reset clears context ===");
  const t3 = await api("POST", "/agents/chat", {
    agentId,
    messages: [{ role: "user", content: "Hello, fresh start!" }],
    reset: true,
  });
  check("status 200",        t3.status,            200);
  check("contextLength=2",   t3.data.contextLength, 2); // reset → only new turn
  check("reply non-empty",   t3.data.reply.length > 0, true);
  console.log("  [contextLength after reset]", t3.data.contextLength);

  // ── TEST 4: Model switching works ─────────────────────────────────────────
  console.log("\n=== TEST 4: Model switching ===");
  const t4 = await api("POST", "/agents/chat", {
    agentId,
    messages: [{ role: "user", content: "Name one planet." }],
    model: "qwen2.5:7b",
    reset: true,
  });
  check("status 200",           t4.status,          200);
  check("modelUsed=qwen2.5:7b", t4.data.modelUsed,  "qwen2.5:7b");
  check("reply non-empty",      t4.data.reply.length > 0, true);
  console.log("  [model used]", t4.data.modelUsed);

  // ── TEST 5: Invalid agentId → 404 ─────────────────────────────────────────
  console.log("\n=== TEST 5: Invalid agentId → 404 ===");
  const t5 = await api("POST", "/agents/chat", {
    agentId: "00000000-0000-0000-0000-000000000000",
    messages: [{ role: "user", content: "Hello" }],
  });
  check("status 404",     t5.status,      404);
  check("error exists",   !!t5.data.error, true);
  console.log("  [error]", t5.data.error);

  // ── Models endpoint (bonus) ───────────────────────────────────────────────
  console.log("\n=== BONUS: GET /models (listAvailableModels fix) ===");
  const tM = await api("GET", "/models");
  check("status 200",         tM.status,              200);
  check("models array",       Array.isArray(tM.data.models), true);
  check("models non-empty",   tM.data.models.length > 0,     true);
  console.log("  [models]", tM.data.models.join(", "));

  console.log("\n=== ALL TESTS DONE ===");
}

run().catch(console.error).finally(() => process.exit(0));
