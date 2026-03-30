"use strict";

const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const { getImageQueue } = require("../queues/imageQueue");
const { getCacheConnection } = require("../lib/redis");
const { enhancePrompt, DEFAULT_NEGATIVE } = require("../services/promptEnhancer");

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
  // ── POST /image/enhance ───────────────────────────────────────────────────
  fastify.post("/image/enhance", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { prompt, style } = request.body || {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }

    const result = await enhancePrompt(prompt.trim(), { style: style || undefined });
    return reply.send({
      enhancedPrompt: result.enhancedPrompt,
      negativePrompt: result.negativePrompt,
      enhanced: result.enhanced,
      originalPrompt: prompt.trim(),
    });
  });

  // ── POST /image/generate ──────────────────────────────────────────────────
  fastify.post("/image/generate", { preHandler: [authMiddleware] }, async (request, reply) => {
    // negativePrompt supplied = prompt already enhanced by client (skip auto-enhance)
    const { prompt, width = 1024, height = 1024, negativePrompt, style } = request.body || {};

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

    // Auto-enhance only if client hasn't already provided an enhanced prompt+negative
    let finalPrompt = prompt.trim();
    let finalNegative = negativePrompt || null;

    if (!finalNegative) {
      const enhanced = await enhancePrompt(finalPrompt, { style: style || undefined });
      finalPrompt = enhanced.enhancedPrompt;
      finalNegative = enhanced.negativePrompt;
    }

    const jobId = uuidv4();
    const queue = getImageQueue();

    await queue.add(
      "generate",
      {
        prompt: finalPrompt,
        negativePrompt: finalNegative || DEFAULT_NEGATIVE,
        originalPrompt: prompt.trim(),
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
      originalPrompt: job.data.originalPrompt ?? job.data.prompt,
      negativePrompt: job.data.negativePrompt ?? null,
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
      originalPrompt: job.data?.originalPrompt ?? job.data?.prompt ?? "",
      width: job.data?.width ?? 1024,
      height: job.data?.height ?? 1024,
      url: job.returnvalue?.url ?? null,
      error: state === "failed" ? (job.failedReason ?? "Image generation failed") : null,
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

  // ── DELETE /image/:id ─────────────────────────────────────────────────────
  fastify.delete("/image/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params;

    process.stdout.write(`[image:delete] id=${id} user=${request.userId}\n`);

    if (!id || typeof id !== "string" || !id.trim()) {
      return reply.code(400).send({ error: "Invalid id" });
    }

    const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";
    const path = require("path");

    // Helper: try to delete a file, ignore ENOENT
    function tryUnlink(filePath) {
      try {
        fs.unlinkSync(filePath);
        process.stdout.write(`[image:delete] removed file: ${filePath}\n`);
        return true;
      } catch (e) {
        if (e.code !== "ENOENT") {
          process.stderr.write(`[image:delete] unlink error (${filePath}): ${e.message}\n`);
        }
        return false;
      }
    }

    let fileDeleted = false;
    let jobFound = false;

    // 1. Try via BullMQ job (has exact localPath)
    const queue = getImageQueue();
    try {
      const job = await queue.getJob(id);
      if (job) {
        jobFound = true;
        const localPath = job.returnvalue?.localPath;
        if (localPath) fileDeleted = tryUnlink(localPath);

        // Release user active-job counter
        try {
          const redis = getCacheConnection();
          const key = userJobKey(job.data?.userId);
          if (key) {
            const cur = Number(await redis.get(key)) || 0;
            if (cur > 0) await redis.set(key, cur - 1, "EX", 300);
          }
        } catch { /* ignore */ }

        // Remove from queue
        try { await job.remove(); } catch { /* ignore */ }
      }
    } catch (e) {
      process.stderr.write(`[image:delete] queue lookup error: ${e.message}\n`);
    }

    // 2. Fallback: if job not in queue (BullMQ cleaned it up), try common extensions by jobId
    if (!fileDeleted) {
      for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
        const candidate = path.join(OUTPUT_DIR, `${id}${ext}`);
        if (tryUnlink(candidate)) { fileDeleted = true; break; }
      }
    }

    process.stdout.write(`[image:delete] done — jobFound=${jobFound} fileDeleted=${fileDeleted}\n`);

    // Always return success — idempotent operation
    return reply.send({
      success: true,
      deleted: id,
      ...((!jobFound && !fileDeleted) ? { warning: "Job and file not found, may have been already deleted" } : {}),
    });
  });
};
