"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const { getImageQueue } = require("../queues/imageQueue");
const { getCacheConnection } = require("../lib/redis");
const { enhancePrompt, DEFAULT_NEGATIVE } = require("../services/promptEnhancer");

const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const MIN_DIM = 256;

const USER_JOB_LIMIT = 1;

const REFS_DIR = process.env.IMAGE_REFS_DIR || "/var/www/site-al.ru/uploads/refs";
const REFS_PUBLIC = process.env.IMAGE_REFS_PUBLIC || "https://site-al.ru/uploads/refs";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";

const VALID_MODES = ["text", "variation", "reference", "inpaint"];

function userJobKey(userId) {
  return `image:active:${userId}`;
}

module.exports = async function imageRoutes(fastify) {
  // Register multipart for the upload-ref endpoint
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 20 * 1024 * 1024, files: 2, fields: 4 },
  });

  // ── POST /image/upload-ref ────────────────────────────────────────────────
  // Upload a reference or mask image. Returns a public URL to use in generate.
  fastify.post("/image/upload-ref", { preHandler: [authMiddleware] }, async (request, reply) => {
    let file;
    try {
      file = await request.file();
    } catch (e) {
      return reply.code(400).send({ error: "Multipart file expected" });
    }
    if (!file) {
      return reply.code(400).send({ error: "No file provided" });
    }

    const ext = path.extname(file.filename).toLowerCase() || ".png";
    const allowed = [".png", ".jpg", ".jpeg", ".webp"];
    if (!allowed.includes(ext)) {
      return reply.code(400).send({ error: "Only PNG, JPG, WEBP images allowed" });
    }

    fs.mkdirSync(REFS_DIR, { recursive: true });

    const id = uuidv4();
    const savedName = `${id}${ext}`;
    const localPath = path.join(REFS_DIR, savedName);

    const buf = await file.toBuffer();
    fs.writeFileSync(localPath, buf);

    const refUrl = `${REFS_PUBLIC}/${savedName}`;
    process.stdout.write(`[image:upload-ref] saved ${localPath} → ${refUrl}\n`);

    return reply.send({ refUrl, id, filename: savedName });
  });

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
    const {
      prompt,
      width = 1024,
      height = 1024,
      negativePrompt,
      style,
      mode = "text",
      variations = 4,
      referenceImageUrl,
      strength = 0.5,
      maskUrl,
    } = request.body || {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }

    const resolvedMode = VALID_MODES.includes(mode) ? mode : "text";

    if (resolvedMode === "reference" && !referenceImageUrl) {
      return reply.code(400).send({ error: "referenceImageUrl required for reference mode" });
    }
    if (resolvedMode === "inpaint" && (!referenceImageUrl || !maskUrl)) {
      return reply.code(400).send({ error: "referenceImageUrl and maskUrl required for inpaint mode" });
    }

    const w = Math.min(Math.max(Number(width) || 1024, MIN_DIM), MAX_WIDTH);
    const h = Math.min(Math.max(Number(height) || 1024, MIN_DIM), MAX_HEIGHT);

    // Per-user rate limit
    const redis = getCacheConnection();
    let activeCount = 0;
    try {
      activeCount = Number(await redis.get(userJobKey(request.userId))) || 0;
    } catch { /* Redis unavailable → allow */ }

    if (activeCount >= USER_JOB_LIMIT) {
      return reply.code(429).send({
        error: "Идёт активная генерация. Подождите завершения.",
      });
    }

    // Auto-enhance only for text/variation modes (not reference/inpaint where prompt is often short/specific)
    let finalPrompt = prompt.trim();
    let finalNegative = negativePrompt || null;

    if (!finalNegative && (resolvedMode === "text" || resolvedMode === "variation")) {
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
        mode: resolvedMode,
        variations: Math.min(Math.max(Number(variations) || 4, 1), 8),
        referenceImageUrl: referenceImageUrl || null,
        strength: Math.min(Math.max(Number(strength) || 0.5, 0.1), 1.0),
        maskUrl: maskUrl || null,
      },
      { jobId }
    );

    try {
      await redis.set(userJobKey(request.userId), activeCount + 1, "EX", 300);
    } catch { /* ignore */ }

    return reply.code(202).send({ jobId, status: "queued", mode: resolvedMode, message: "Генерация начата" });
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
      mode: job.data.mode || "text",
      prompt: job.data.prompt,
      originalPrompt: job.data.originalPrompt ?? job.data.prompt,
      negativePrompt: job.data.negativePrompt ?? null,
      width: job.data.width,
      height: job.data.height,
      createdAt: new Date(job.timestamp).toISOString(),
    };

    if (state === "completed" && result) {
      response.url = result.url;
      response.urls = result.urls || [result.url];
      response.count = result.count || 1;
    }
    if (state === "failed") {
      response.error = job.failedReason || "Ошибка генерации. Попробуйте изменить описание";
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
      mode: job.data?.mode || "text",
      prompt: job.data?.prompt ?? "",
      originalPrompt: job.data?.originalPrompt ?? job.data?.prompt ?? "",
      width: job.data?.width ?? 1024,
      height: job.data?.height ?? 1024,
      url: job.returnvalue?.url ?? null,
      urls: job.returnvalue?.urls ?? (job.returnvalue?.url ? [job.returnvalue.url] : null),
      count: job.returnvalue?.count ?? null,
      error: state === "failed" ? (job.failedReason ?? "Ошибка генерации. Попробуйте изменить описание") : null,
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

    const queue = getImageQueue();
    try {
      const job = await queue.getJob(id);
      if (job) {
        jobFound = true;
        // Delete all files (support variations with multiple localPaths)
        const localPaths = job.returnvalue?.localPaths || (job.returnvalue?.localPath ? [job.returnvalue.localPath] : []);
        for (const lp of localPaths) {
          if (tryUnlink(lp)) fileDeleted = true;
        }

        try {
          const redis = getCacheConnection();
          const key = userJobKey(job.data?.userId);
          if (key) {
            const cur = Number(await redis.get(key)) || 0;
            if (cur > 0) await redis.set(key, cur - 1, "EX", 300);
          }
        } catch { /* ignore */ }

        try { await job.remove(); } catch { /* ignore */ }
      }
    } catch (e) {
      process.stderr.write(`[image:delete] queue lookup error: ${e.message}\n`);
    }

    // Fallback: scan by jobId with common extensions and variation suffixes
    if (!fileDeleted) {
      const exts = [".png", ".jpg", ".jpeg", ".webp"];
      // Try base + variations (_1 through _8)
      const suffixes = ["", "_1", "_2", "_3", "_4", "_5", "_6", "_7"];
      outer: for (const suffix of suffixes) {
        for (const ext of exts) {
          const candidate = path.join(OUTPUT_DIR, `${id}${suffix}${ext}`);
          if (tryUnlink(candidate)) {
            fileDeleted = true;
            if (suffix === "") break outer; // single image found
            // continue deleting remaining variation files
          }
        }
      }
    }

    process.stdout.write(`[image:delete] done — jobFound=${jobFound} fileDeleted=${fileDeleted}\n`);

    return reply.send({
      success: true,
      deleted: id,
      ...((!jobFound && !fileDeleted) ? { warning: "Job and file not found, may have been already deleted" } : {}),
    });
  });
};
