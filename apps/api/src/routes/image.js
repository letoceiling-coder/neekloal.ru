"use strict";

const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const { getImageQueue } = require("../queues/imageQueue");
const { getCacheConnection } = require("../lib/redis");

const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const MIN_DIM = 256;

// Per-user concurrent job limit
const USER_JOB_LIMIT = 1;

/**
 * Key for tracking active job count per user in Redis.
 * TTL = 5 min (guard against leaked keys).
 */
function userJobKey(userId) {
  return `image:active:${userId}`;
}

module.exports = async function imageRoutes(fastify) {
  // ── POST /image/generate ──────────────────────────────────────────────────
  fastify.post("/image/generate", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { prompt, width = 1024, height = 1024 } = request.body || {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }
    const w = Math.min(Math.max(Number(width) || 1024, MIN_DIM), MAX_WIDTH);
    const h = Math.min(Math.max(Number(height) || 1024, MIN_DIM), MAX_HEIGHT);

    // Per-user rate: max 1 active job at a time
    const redis = getCacheConnection();
    let activeCount = 0;
    try {
      activeCount = Number(await redis.get(userJobKey(request.userId))) || 0;
    } catch { /* Redis unavailable → allow */ }

    if (activeCount >= USER_JOB_LIMIT) {
      return reply.code(429).send({
        error: "You already have an active generation. Please wait for it to finish.",
      });
    }

    const jobId = uuidv4();
    const queue = getImageQueue();

    await queue.add(
      "generate",
      {
        prompt: prompt.trim(),
        width: w,
        height: h,
        jobId,
        userId: request.userId,
        organizationId: request.organizationId,
      },
      { jobId }
    );

    // Track active job
    try {
      await redis.set(userJobKey(request.userId), activeCount + 1, "EX", 300);
    } catch { /* ignore */ }

    return reply.code(202).send({ jobId, status: "queued", message: "Generation started" });
  });

  // ── GET /image/status/:id ─────────────────────────────────────────────────
  fastify.get("/image/status/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params;
    const queue = getImageQueue();

    const job = await queue.getJob(id);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }

    const state = await job.getState();
    const result = job.returnvalue;

    // Release user job counter on completion/failure
    if (state === "completed" || state === "failed") {
      try {
        const redis = getCacheConnection();
        const key = userJobKey(job.data.userId);
        const cur = Number(await redis.get(key)) || 0;
        if (cur > 0) await redis.set(key, cur - 1, "EX", 300);
      } catch { /* ignore */ }
    }

    const response = {
      jobId: id,
      status: state,
      prompt: job.data.prompt,
      width: job.data.width,
      height: job.data.height,
      createdAt: new Date(job.timestamp).toISOString(),
    };

    if (state === "completed" && result?.url) {
      response.url = result.url;
    }
    if (state === "failed") {
      response.error = job.failedReason || "Generation failed";
    }
    if (state === "active") {
      response.progress = job.progress || 0;
    }

    return response;
  });

  // ── GET /image/list ───────────────────────────────────────────────────────
  fastify.get("/image/list", { preHandler: [authMiddleware] }, async (request, reply) => {
    const queue = getImageQueue();

    const [completed, failed, active, waiting] = await Promise.all([
      queue.getJobs(["completed"], 0, 19),
      queue.getJobs(["failed"], 0, 4),
      queue.getJobs(["active"], 0, 4),
      queue.getJobs(["waiting"], 0, 4),
    ]);

    const toItem = (job, state) => ({
      jobId: job.id,
      status: state,
      prompt: job.data?.prompt ?? "",
      width: job.data?.width ?? 1024,
      height: job.data?.height ?? 1024,
      url: job.returnvalue?.url ?? null,
      error: state === "failed" ? (job.failedReason ?? "failed") : null,
      createdAt: new Date(job.timestamp).toISOString(),
    });

    const items = [
      ...active.map((j) => toItem(j, "active")),
      ...waiting.map((j) => toItem(j, "waiting")),
      ...completed.map((j) => toItem(j, "completed")),
      ...failed.map((j) => toItem(j, "failed")),
    ].slice(0, 20);

    return { items, total: items.length };
  });
};
