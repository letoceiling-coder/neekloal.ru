"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const { getImageQueue } = require("../queues/imageQueue");
const { getCacheConnection } = require("../lib/redis");
const { enhancePrompt, DEFAULT_NEGATIVE } = require("../services/promptEnhancer");
const prisma = require("../lib/prisma");

const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const MIN_DIM = 256;

const USER_JOB_LIMIT = 1;

const REFS_DIR = process.env.IMAGE_REFS_DIR || "/var/www/site-al.ru/uploads/refs";
const REFS_PUBLIC = process.env.IMAGE_REFS_PUBLIC || "https://site-al.ru/uploads/refs";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";

const VALID_MODES = ["text", "variation", "reference", "inpaint"];

function userJobKey(userId) { return `image:active:${userId}`; }

module.exports = async function imageRoutes(fastify) {
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 20 * 1024 * 1024, files: 2, fields: 4 },
  });

  // ── POST /image/upload-ref ────────────────────────────────────────────────
  fastify.post("/image/upload-ref", { preHandler: [authMiddleware] }, async (request, reply) => {
    let file;
    try { file = await request.file(); } catch (e) {
      return reply.code(400).send({ error: "Multipart file expected" });
    }
    if (!file) return reply.code(400).send({ error: "No file provided" });

    const ext = path.extname(file.filename).toLowerCase() || ".png";
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      return reply.code(400).send({ error: "Only PNG, JPG, WEBP images allowed" });
    }

    fs.mkdirSync(REFS_DIR, { recursive: true });
    const id = uuidv4();
    const savedName = `${id}${ext}`;
    const localPath = path.join(REFS_DIR, savedName);
    fs.writeFileSync(localPath, await file.toBuffer());

    const refUrl = `${REFS_PUBLIC}/${savedName}`;
    process.stdout.write(`[image:upload-ref] saved ${localPath} → ${refUrl}\n`);
    return reply.send({ refUrl, id, filename: savedName });
  });

  // ── POST /image/enhance ───────────────────────────────────────────────────
  fastify.post("/image/enhance", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { prompt, style, aspectRatio } = request.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }

    // Load user system prompt
    const userSettings = await prisma.userImageSettings.findUnique({
      where: { userId: request.userId },
    }).catch(() => null);
    const systemPrompt = userSettings?.useSystemPrompt ? (userSettings.imageSystemPrompt || null) : null;

    const result = await enhancePrompt(prompt.trim(), { style, aspectRatio, systemPrompt });
    return reply.send({
      enhancedPrompt: result.enhancedPrompt,
      negativePrompt: result.negativePrompt,
      enhanced: result.enhanced,
      originalPrompt: prompt.trim(),
      appliedStyle: result.appliedStyle,
      appliedAspectRatio: result.appliedAspectRatio,
      appliedSystemPrompt: result.appliedSystemPrompt,
    });
  });

  // ── POST /image/generate ──────────────────────────────────────────────────
  fastify.post("/image/generate", { preHandler: [authMiddleware] }, async (request, reply) => {
    const {
      prompt, width = 1024, height = 1024,
      negativePrompt, style, aspectRatio,
      mode = "text", smartMode,
      variations = 4,
      referenceImageUrl, strength = 0.5, maskUrl,
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
    const useSmartEnhance = smartMode !== false;

    // Per-user rate limit
    const redis = getCacheConnection();
    let activeCount = 0;
    try { activeCount = Number(await redis.get(userJobKey(request.userId))) || 0; } catch { /* allow */ }
    if (activeCount >= USER_JOB_LIMIT) {
      return reply.code(429).send({ error: "Идёт активная генерация. Подождите завершения." });
    }

    let finalPrompt = prompt.trim();
    let finalNegative = negativePrompt || null;
    let enhanceResult = null;

    if (!finalNegative && useSmartEnhance) {
      // Load user system prompt
      const userSettings = await prisma.userImageSettings.findUnique({
        where: { userId: request.userId },
      }).catch(() => null);
      const systemPrompt = userSettings?.useSystemPrompt ? (userSettings.imageSystemPrompt || null) : null;

      enhanceResult = await enhancePrompt(finalPrompt, {
        style,
        aspectRatio,
        systemPrompt,
      });
      finalPrompt = enhanceResult.enhancedPrompt;
      finalNegative = enhanceResult.negativePrompt;
    }

    const jobId = uuidv4();
    const queue = getImageQueue();

    await queue.add("generate", {
      prompt: finalPrompt,
      negativePrompt: finalNegative || DEFAULT_NEGATIVE,
      originalPrompt: prompt.trim(),
      width: w, height: h, jobId,
      userId: request.userId,
      organizationId: request.organizationId,
      mode: resolvedMode,
      variations: Math.min(Math.max(Number(variations) || 4, 1), 8),
      referenceImageUrl: referenceImageUrl || null,
      strength: Math.min(Math.max(Number(strength) || 0.5, 0.1), 1.0),
      maskUrl: maskUrl || null,
      style: style || null,
      aspectRatio: aspectRatio || null,
    }, { jobId });

    try { await redis.set(userJobKey(request.userId), activeCount + 1, "EX", 300); } catch { /* ignore */ }

    return reply.code(202).send({
      jobId,
      status: "queued",
      mode: resolvedMode,
      message: "Генерация начата",
      enhanceApplied: enhanceResult
        ? {
            style: enhanceResult.appliedStyle,
            aspectRatio: enhanceResult.appliedAspectRatio,
            systemPrompt: enhanceResult.appliedSystemPrompt,
          }
        : null,
    });
  });

  // ── GET /image/status/:id ─────────────────────────────────────────────────
  fastify.get("/image/status/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params;
    const queue = getImageQueue();
    const job = await queue.getJob(id);
    if (!job) return reply.code(404).send({ error: "Job not found" });

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
      style: job.data.style ?? null,
      aspectRatio: job.data.aspectRatio ?? null,
      width: job.data.width,
      height: job.data.height,
      createdAt: new Date(job.timestamp).toISOString(),
    };

    if (state === "completed" && result) {
      response.url = result.url;
      response.urls = result.urls || [result.url];
      response.dbIds = result.dbIds || [];
      response.count = result.count || 1;
    }
    if (state === "failed") {
      response.error = job.failedReason || "Ошибка генерации. Попробуйте изменить описание";
    }
    if (state === "active") response.progress = job.progress || 0;

    return response;
  });

  // ── GET /image/list ───────────────────────────────────────────────────────
  // Returns flat list from DB (each variation is its own entry).
  // Falls back to BullMQ if DB is empty (e.g. legacy data).
  fastify.get("/image/list", { preHandler: [authMiddleware] }, async (request, reply) => {
    const take = Math.min(Number(request.query?.limit) || 40, 100);

    // Try DB first
    try {
      const rows = await prisma.generatedImage.findMany({
        where: { organizationId: request.organizationId },
        orderBy: { createdAt: "desc" },
        take,
      });

      if (rows.length > 0) {
        return {
          source: "db",
          items: rows.map((r) => ({
            id: r.id,           // DB id — use for DELETE
            jobId: r.jobId,     // BullMQ job batch id
            status: "completed",
            mode: r.mode,
            prompt: r.prompt,
            originalPrompt: r.originalPrompt ?? r.prompt,
            negativePrompt: r.negativePrompt ?? null,
            style: r.style ?? null,
            aspectRatio: r.aspectRatio ?? null,
            width: r.width,
            height: r.height,
            url: r.url,
            urls: [r.url],
            variantIndex: r.variantIndex,
            count: 1,
            error: null,
            createdAt: r.createdAt.toISOString(),
          })),
          total: rows.length,
        };
      }
    } catch (e) {
      process.stderr.write(`[image:list] DB error, falling back to BullMQ: ${e.message}\n`);
    }

    // BullMQ fallback (legacy / empty DB)
    const queue = getImageQueue();
    const [completed, failed, active, waiting] = await Promise.all([
      queue.getJobs(["completed"], 0, 19),
      queue.getJobs(["failed"], 0, 4),
      queue.getJobs(["active"], 0, 4),
      queue.getJobs(["waiting"], 0, 4),
    ]);

    const toItem = (job, state) => ({
      id: job.id,
      jobId: job.id,
      status: state,
      mode: job.data?.mode || "text",
      prompt: job.data?.prompt ?? "",
      originalPrompt: job.data?.originalPrompt ?? job.data?.prompt ?? "",
      style: job.data?.style ?? null,
      aspectRatio: job.data?.aspectRatio ?? null,
      width: job.data?.width ?? 1024,
      height: job.data?.height ?? 1024,
      url: job.returnvalue?.url ?? null,
      urls: job.returnvalue?.urls ?? (job.returnvalue?.url ? [job.returnvalue.url] : null),
      count: job.returnvalue?.count ?? null,
      error: state === "failed" ? (job.failedReason ?? "Ошибка генерации") : null,
      createdAt: new Date(job.timestamp).toISOString(),
    });

    const items = [
      ...active.map((j) => toItem(j, "active")),
      ...waiting.map((j) => toItem(j, "waiting")),
      ...completed.map((j) => toItem(j, "completed")),
      ...failed.map((j) => toItem(j, "failed")),
    ].slice(0, 20);

    return { source: "queue", items, total: items.length };
  });

  // ── DELETE /image/:id ─────────────────────────────────────────────────────
  // Accepts either a DB record id (UUID) or a BullMQ job id.
  // Deletes ONLY the single image record (not the whole batch/job).
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
        if (e.code !== "ENOENT") process.stderr.write(`[image:delete] unlink error (${filePath}): ${e.message}\n`);
        return false;
      }
    }

    let fileDeleted = false;
    let dbDeleted = false;

    // 1. Try DB record first (preferred: single image delete)
    try {
      const record = await prisma.generatedImage.findFirst({
        where: {
          OR: [{ id }, { jobId: id }],
          organizationId: request.organizationId,
        },
      });
      if (record) {
        tryUnlink(record.localPath);
        await prisma.generatedImage.delete({ where: { id: record.id } });
        dbDeleted = true;
        fileDeleted = true;
        process.stdout.write(`[image:delete] DB record deleted: ${record.id}\n`);
      }
    } catch (e) {
      process.stderr.write(`[image:delete] DB delete error: ${e.message}\n`);
    }

    // 2. If not in DB, try BullMQ job (legacy / all variants)
    if (!dbDeleted) {
      const queue = getImageQueue();
      try {
        const job = await queue.getJob(id);
        if (job) {
          const localPaths = job.returnvalue?.localPaths || (job.returnvalue?.localPath ? [job.returnvalue.localPath] : []);
          for (const lp of localPaths) { if (tryUnlink(lp)) fileDeleted = true; }
          try {
            const redis = getCacheConnection();
            const key = userJobKey(job.data?.userId);
            if (key) {
              const cur = Number(await redis.get(key)) || 0;
              if (cur > 0) await redis.set(key, cur - 1, "EX", 300);
            }
          } catch { /* ignore */ }
          try { await job.remove(); } catch { /* ignore */ }
          fileDeleted = true;
        }
      } catch (e) {
        process.stderr.write(`[image:delete] BullMQ error: ${e.message}\n`);
      }
    }

    // 3. Fallback: try by filename pattern
    if (!fileDeleted) {
      const suffixes = ["", "_1", "_2", "_3", "_4", "_5", "_6", "_7"];
      for (const suffix of suffixes) {
        for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
          if (tryUnlink(path.join(OUTPUT_DIR, `${id}${suffix}${ext}`))) fileDeleted = true;
        }
      }
    }

    process.stdout.write(`[image:delete] done — dbDeleted=${dbDeleted} fileDeleted=${fileDeleted}\n`);
    return reply.send({
      success: true,
      deleted: id,
      ...(!dbDeleted && !fileDeleted ? { warning: "Not found, may have been already deleted" } : {}),
    });
  });

  // ── GET /image/settings ───────────────────────────────────────────────────
  fastify.get("/image/settings", { preHandler: [authMiddleware] }, async (request, reply) => {
    const settings = await prisma.userImageSettings.findUnique({
      where: { userId: request.userId },
    }).catch(() => null);

    return reply.send({
      imageSystemPrompt: settings?.imageSystemPrompt ?? "",
      useSystemPrompt: settings?.useSystemPrompt ?? false,
    });
  });

  // ── PATCH /image/settings ─────────────────────────────────────────────────
  fastify.patch("/image/settings", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { imageSystemPrompt, useSystemPrompt } = request.body || {};

    const data = {};
    if (typeof imageSystemPrompt === "string") data.imageSystemPrompt = imageSystemPrompt;
    if (typeof useSystemPrompt === "boolean") data.useSystemPrompt = useSystemPrompt;

    const settings = await prisma.userImageSettings.upsert({
      where: { userId: request.userId },
      update: data,
      create: {
        id: uuidv4(),
        userId: request.userId,
        imageSystemPrompt: typeof imageSystemPrompt === "string" ? imageSystemPrompt : null,
        useSystemPrompt: typeof useSystemPrompt === "boolean" ? useSystemPrompt : false,
      },
    });

    return reply.send({
      imageSystemPrompt: settings.imageSystemPrompt ?? "",
      useSystemPrompt: settings.useSystemPrompt,
    });
  });
};
