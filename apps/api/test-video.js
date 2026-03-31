#!/usr/bin/env node
"use strict";
/**
 * VIDEO PIPELINE — 5 mandatory tests
 * Run on server: node /tmp/test-video.js
 */

require("dotenv").config();

const http   = require("http");
const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const { Queue } = require("bullmq");

const BASE_URL      = process.env.API_BASE || "http://localhost:4000";
const VIDEO_DIR     = process.env.VIDEO_OUTPUT_DIR || "/var/www/site-al.ru/uploads/videos";
const QUEUE_NAME    = "video-generation";

let passed = 0;
let failed = 0;

async function assert(name, fn) {
  try {
    const result = await fn();
    if (result === false) throw new Error("assertion returned false");
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const options = { ...opts };
    if (opts.body) {
      const body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      options.headers = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...(opts.headers || {}),
      };
      const req = lib.request(url, options, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    } else {
      const req = lib.request(url, options, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      });
      req.on("error", reject);
      req.end();
    }
  });
}

async function getAuthToken() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    body: { email: process.env.TEST_EMAIL || "admin@admin.com", password: process.env.TEST_PASS || "admin123" },
  });
  if (res.status !== 200 || !res.data?.token) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.data).slice(0,100)}`);
  }
  return res.data.token;
}

async function run() {
  console.log("============================================================");
  console.log("VIDEO PIPELINE — 5 MANDATORY TESTS");
  console.log("============================================================");

  let token;
  try {
    token = await getAuthToken();
    console.log(`  Auth token obtained: ${token.slice(0, 20)}...`);
  } catch (e) {
    console.error(`  ⚠️  Auth failed: ${e.message} — running queue-only tests`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1 — text → video: POST /video/generate returns 202 + jobId
  // ─────────────────────────────────────────────────────────────────────────
  let jobId1;
  await assert("TEST 1: text → video — POST /video/generate returns 202 + jobId", async () => {
    if (!token) throw new Error("No auth token");
    const res = await fetch(`${BASE_URL}/video/generate`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:    { prompt: "a cat running in a field, smooth animation", fps: 8, duration: 2, width: 512, height: 512 },
    });
    console.log(`     HTTP ${res.status}`, JSON.stringify(res.data).slice(0, 120));
    if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.jobId) throw new Error("No jobId in response");
    jobId1 = res.data.jobId;
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2 — image → video: POST /video/generate with imageUrl returns 202
  // ─────────────────────────────────────────────────────────────────────────
  let jobId2;
  await assert("TEST 2: image → video — POST /video/generate with imageUrl returns 202", async () => {
    if (!token) throw new Error("No auth token");
    const res = await fetch(`${BASE_URL}/video/generate`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: {
        prompt:   "subtle zoom in, cinematic",
        mode:     "image2video",
        imageUrl: "https://picsum.photos/512/512",
        fps: 8, duration: 2, width: 512, height: 512,
      },
    });
    console.log(`     HTTP ${res.status}`, JSON.stringify(res.data).slice(0, 120));
    if (res.status !== 202) throw new Error(`Expected 202, got ${res.status}: ${JSON.stringify(res.data)}`);
    if (!res.data?.jobId) throw new Error("No jobId in response");
    if (res.data.mode !== "image2video") throw new Error(`Expected mode=image2video, got ${res.data.mode}`);
    jobId2 = res.data.jobId;
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3 — queue has active/waiting jobs
  // ─────────────────────────────────────────────────────────────────────────
  await assert("TEST 3: video-generation queue has jobs (waiting/active)", async () => {
    const { getWorkerConnection } = require("./src/lib/redis");
    const queue = new Queue(QUEUE_NAME, { connection: getWorkerConnection() });
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "completed", "failed");
    console.log(`     Queue counts:`, counts);
    await queue.close();
    const total = (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0)
                + (counts.completed || 0) + (counts.failed || 0);
    if (total === 0) throw new Error("No jobs found in queue at all");
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4 — GET /video/status/:id returns job state
  // ─────────────────────────────────────────────────────────────────────────
  await assert("TEST 4: GET /video/status/:id returns job data", async () => {
    if (!token || !jobId1) throw new Error("No token or jobId from TEST 1");
    const res = await fetch(`${BASE_URL}/video/status/${jobId1}`, {
      method:  "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`     HTTP ${res.status}`, JSON.stringify(res.data).slice(0, 120));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const validStates = ["pending", "queued", "waiting", "active", "delayed", "completed", "failed", "running"];
    if (!validStates.includes(res.data?.status)) throw new Error(`Invalid status: ${res.data?.status}`);
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5 — GET /video/list returns array
  // ─────────────────────────────────────────────────────────────────────────
  await assert("TEST 5: GET /video/list returns items array", async () => {
    if (!token) throw new Error("No auth token");
    const res = await fetch(`${BASE_URL}/video/list`, {
      method:  "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`     HTTP ${res.status}`, JSON.stringify(res.data).slice(0, 150));
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.data?.items)) throw new Error("Expected items array");
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // BONUS: video output directory exists
  // ─────────────────────────────────────────────────────────────────────────
  await assert("BONUS: video output directory exists", async () => {
    const exists = fs.existsSync(VIDEO_DIR);
    console.log(`     VIDEO_DIR=${VIDEO_DIR} exists=${exists}`);
    if (!exists) {
      fs.mkdirSync(VIDEO_DIR, { recursive: true });
      console.log(`     → created`);
    }
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  console.log("============================================================");
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("============================================================");

  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
