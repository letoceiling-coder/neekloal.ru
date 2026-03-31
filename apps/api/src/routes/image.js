"use strict";

const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const authMiddleware = require("../middleware/auth");
const { getImageQueue } = require("../queues/imageQueue");
const { getCacheConnection } = require("../lib/redis");
const { enhancePrompt, DEFAULT_NEGATIVE } = require("../services/promptEnhancer");
const { analyzePrompt }   = require("../services/aiBrainV2");
const { buildPipeline }   = require("../services/aiOrchestrator");
const prisma = require("../lib/prisma");

const MAX_WIDTH = 2048;
const MAX_HEIGHT = 2048;
const MIN_DIM = 256;

const USER_JOB_LIMIT = 1;

const REFS_DIR = process.env.IMAGE_REFS_DIR || "/var/www/site-al.ru/uploads/refs";
const REFS_PUBLIC = process.env.IMAGE_REFS_PUBLIC || "https://site-al.ru/uploads/refs";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/var/www/site-al.ru/uploads/images";

const VALID_MODES = ["text", "variation", "reference", "inpaint", "controlnet"];

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

    // Brain v2 analysis first
    const brain = analyzePrompt(prompt.trim());

    const finalStyle = style || brain.style;
    const finalAspectRatio = aspectRatio || brain.aspectRatioLabel;

    const userSettings = await prisma.userImageSettings.findUnique({
      where: { userId: request.userId },
    }).catch(() => null);
    const systemPrompt = userSettings?.useSystemPrompt ? (userSettings.imageSystemPrompt || null) : null;
    const enhancerSystem = [systemPrompt, brain.composition, brain.enhancedPromptHints].filter(Boolean).join("\n") || null;

    const result = await enhancePrompt(prompt.trim(), { style: finalStyle, aspectRatio: finalAspectRatio, systemPrompt: enhancerSystem, brain });
    return reply.send({
      enhancedPrompt: result.enhancedPrompt,
      negativePrompt: result.negativePrompt,
      enhanced: result.enhanced,
      originalPrompt: prompt.trim(),
      appliedStyle: result.appliedStyle,
      appliedAspectRatio: result.appliedAspectRatio,
      appliedSystemPrompt: result.appliedSystemPrompt,
      brain: {
        type: brain.type,
        typeLabel: brain.typeLabel,
        style: brain.style,
        composition: brain.composition,
        suggestedMode: brain.suggestedMode,
        suggestedSize: brain.suggestedSize,
      },
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
      controlType = "canny",
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
    if (resolvedMode === "controlnet" && !referenceImageUrl) {
      return reply.code(400).send({ error: "referenceImageUrl required for controlnet mode" });
    }
    const resolvedControlType = ["canny", "pose"].includes(controlType) ? controlType : "canny";

    const w = Math.min(Math.max(Number(width) || 1024, MIN_DIM), MAX_WIDTH);
    const h = Math.min(Math.max(Number(height) || 1024, MIN_DIM), MAX_HEIGHT);
    const useSmartEnhance = smartMode !== false;

    // ── ORCHESTRATOR: build pipeline ──────────────────────────────────────────
    const pipeline = buildPipeline({
      prompt:       (prompt || "").trim(),
      hasReference: !!referenceImageUrl,
      hasMask:      !!maskUrl,
      smartMode:    useSmartEnhance,
    });
    const pipelineGenStep    = pipeline.steps.find((s) => s.type === "generate");
    const pipelinePostStep   = pipeline.steps.find((s) => s.type === "postprocess" && s.action === "remove_bg");
    const autoRemoveBg       = !!pipelinePostStep;

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
    let brainResult = null;

    // ── AI Brain v2: analyze prompt + build directives ────────────────────────
    if (useSmartEnhance) {
      brainResult = analyzePrompt(finalPrompt, { enableVariations: resolvedMode === "variation" });
    }

    // ── STEP 4: Mode decision (pipeline-driven, user override respected) ───────
    let appliedMode      = resolvedMode;
    const userForcedMode = resolvedMode !== "text";

    if (!userForcedMode && pipelineGenStep && pipelineGenStep.mode !== "text") {
      // Pipeline detected variation/reference/inpaint from prompt/flags
      appliedMode = pipelineGenStep.mode;
      process.stdout.write(`[pipeline:mode] text → ${appliedMode} (pipeline)\n`);
    } else if (!userForcedMode && brainResult?.suggestedMode === "variation") {
      // Brain fallback (same keyword set, belt-and-suspenders)
      appliedMode = "variation";
      process.stdout.write(`[mode:auto] suggested=variation applied=variation\n`);
    } else {
      process.stdout.write(`[mode:auto] applied=${appliedMode}\n`);
    }

    // Use pipeline count for variations when detected
    const pipelineCount = (pipelineGenStep?.mode === "variation" && pipelineGenStep?.count)
      ? pipelineGenStep.count
      : null;
    const finalVariations = appliedMode === "variation"
      ? Math.min(Math.max(pipelineCount || Number(variations) || 4, 2), 8)
      : Math.min(Math.max(Number(variations) || 1, 1), 8);

    // ── STEP 5: Smart controlnet for referenceImage + brain type ─────────────
    let finalControlType = resolvedControlType;
    let controlStrength  = null;

    if (referenceImageUrl && appliedMode !== "controlnet") {
      const btype = brainResult?.type;
      if (btype === "character") {
        appliedMode      = "controlnet";
        finalControlType = "pose";
        controlStrength  = 0.7;
      } else if (btype === "product") {
        appliedMode      = "controlnet";
        finalControlType = "canny";
        controlStrength  = 0.5;
      } else if (btype === "architecture") {
        appliedMode      = "controlnet";
        finalControlType = "canny";
        controlStrength  = 0.6;
      }
      if (appliedMode === "controlnet") {
        process.stdout.write(
          `[controlnet:auto] type=${btype} controlType=${finalControlType}\n`
        );
        process.stdout.write(
          `[controlnet:strength] type=${btype} controlType=${finalControlType} strength=${controlStrength}\n`
        );
      }
    }

    // ── STEP 5.5: Seed control ────────────────────────────────────────────────
    let finalSeed = null;
    if (appliedMode === "variation") {
      finalSeed = Math.floor(Math.random() * 999999);
    } else if (appliedMode === "text") {
      finalSeed = Date.now() % 1000000;
    }
    process.stdout.write(`[seed] mode=${appliedMode} seed=${finalSeed}\n`);

    // Apply brain suggestions only if user didn't supply explicit values
    const finalStyle = style || (brainResult?.style ?? null);
    const finalAspectRatio = aspectRatio || (brainResult?.aspectRatioLabel ?? null);

    // Use brain-suggested dimensions if user left defaults and brain suggests different
    let finalW = w;
    let finalH = h;
    if (!style && !aspectRatio && brainResult?.suggestedSize) {
      const { w: bw, h: bh } = brainResult.suggestedSize;
      if (bw >= MIN_DIM && bw <= MAX_WIDTH && bh >= MIN_DIM && bh <= MAX_HEIGHT) {
        finalW = bw;
        finalH = bh;
      }
    }

    if (!finalNegative && useSmartEnhance) {
      const userSettings = await prisma.userImageSettings.findUnique({
        where: { userId: request.userId },
      }).catch(() => null);
      const systemPrompt = userSettings?.useSystemPrompt ? (userSettings.imageSystemPrompt || null) : null;

      const compositionHint = brainResult?.composition ?? null;
      const promptHints     = brainResult?.enhancedPromptHints ?? null;
      const enhancerSystemPrompt = [systemPrompt, compositionHint, promptHints].filter(Boolean).join("\n") || null;

      // ── Pass brain (with directives) to enhancer ──────────────────────────
      enhanceResult = await enhancePrompt(finalPrompt, {
        style: finalStyle,
        aspectRatio: finalAspectRatio,
        systemPrompt: enhancerSystemPrompt,
        brain: brainResult,   // ← directives flow here
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
      width: finalW, height: finalH, jobId,
      userId: request.userId,
      organizationId: request.organizationId,
      mode: appliedMode,
      variations: finalVariations,
      referenceImageUrl: referenceImageUrl || null,
      strength: controlStrength !== null
        ? controlStrength
        : Math.min(Math.max(Number(strength) || 0.5, 0.1), 1.0),
      maskUrl: maskUrl || null,
      controlType: finalControlType,
      style: finalStyle,
      aspectRatio: finalAspectRatio,
      seed: finalSeed,
      autoRemoveBg,
    }, { jobId });

    try { await redis.set(userJobKey(request.userId), activeCount + 1, "EX", 300); } catch { /* ignore */ }

    return reply.code(202).send({
      jobId,
      status: "queued",
      mode: appliedMode,
      message: "Генерация начата",
      brain: brainResult
        ? {
            type: brainResult.type,
            typeLabel: brainResult.typeLabel,
            style: brainResult.style,
            composition: brainResult.composition,
            suggestedMode: brainResult.suggestedMode,
            suggestedSize: brainResult.suggestedSize,
            directivesCount: (brainResult.directives?.must?.length ?? 0) + (brainResult.directives?.should?.length ?? 0),
            qualityCount: brainResult.directives?.quality?.length ?? 0,
            modeApplied: appliedMode,
            controlType: finalControlType,
            controlStrength,
            seed: finalSeed,
            directives: {
              must:    brainResult.directives?.must    ?? [],
              should:  brainResult.directives?.should  ?? [],
              quality: brainResult.directives?.quality ?? [],
            },
          }
        : null,
      enhanceApplied: enhanceResult
        ? {
            style: enhanceResult.appliedStyle,
            aspectRatio: enhanceResult.appliedAspectRatio,
            systemPrompt: enhanceResult.appliedSystemPrompt,
          }
        : null,
      pipeline: {
        stepsCount:   pipeline.steps.length,
        steps:        pipeline.steps,
        autoMode:     pipeline.meta.autoMode,
        autoRemoveBg: pipeline.meta.autoRemoveBg,
      },
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

  // ── POST /image/controlnet ────────────────────────────────────────────────
  // Convenience alias — identical to POST /image/generate with mode=controlnet
  fastify.post("/image/controlnet", { preHandler: [authMiddleware] }, async (request, reply) => {
    const body = request.body || {};
    // Inject mode=controlnet and re-use the generate handler via internal redirect
    request.body = { ...body, mode: "controlnet" };

    // Re-run validation and queueing inline (same logic as /image/generate)
    const {
      prompt, width = 1024, height = 1024,
      negativePrompt, style, aspectRatio,
      smartMode, referenceImageUrl, strength = 0.8,
      controlType = "canny",
    } = request.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }
    if (!referenceImageUrl) {
      return reply.code(400).send({ error: "referenceImageUrl is required for ControlNet" });
    }
    const resolvedControlType = ["canny", "pose"].includes(controlType) ? controlType : "canny";

    const w = Math.min(Math.max(Number(width) || 512, 256), 1024);
    const h = Math.min(Math.max(Number(height) || 512, 256), 1024);
    const useSmartEnhance = smartMode !== false;

    const redis = getCacheConnection();
    let activeCount = 0;
    try { activeCount = Number(await redis.get(`image:active:${request.userId}`)) || 0; } catch { /* allow */ }
    if (activeCount >= USER_JOB_LIMIT) {
      return reply.code(429).send({ error: "Идёт активная генерация. Подождите завершения." });
    }

    let finalPrompt = prompt.trim();
    let finalNegative = negativePrompt || null;
    let enhanceResult = null;
    if (!finalNegative && useSmartEnhance) {
      const userSettings = await prisma.userImageSettings.findUnique({ where: { userId: request.userId } }).catch(() => null);
      const systemPrompt = userSettings?.useSystemPrompt ? (userSettings.imageSystemPrompt || null) : null;
      enhanceResult = await enhancePrompt(finalPrompt, { style, aspectRatio, systemPrompt });
      finalPrompt = enhanceResult.enhancedPrompt;
      finalNegative = enhanceResult.negativePrompt;
    }

    const jobId = uuidv4();
    const queue = getImageQueue();
    await queue.add("generate", {
      prompt: finalPrompt, negativePrompt: finalNegative || DEFAULT_NEGATIVE,
      originalPrompt: prompt.trim(), width: w, height: h, jobId,
      userId: request.userId, organizationId: request.organizationId,
      mode: "controlnet", variations: 1,
      referenceImageUrl, strength: Math.min(Math.max(Number(strength) || 0.8, 0.1), 1.0),
      maskUrl: null, controlType: resolvedControlType,
      style: style || null, aspectRatio: aspectRatio || null,
    }, { jobId });

    try { await redis.set(`image:active:${request.userId}`, activeCount + 1, "EX", 300); } catch { /* ignore */ }

    return reply.code(202).send({
      jobId, status: "queued", mode: "controlnet", controlType: resolvedControlType,
      message: `ControlNet (${resolvedControlType}) запущен`,
      enhanceApplied: enhanceResult ? { style: enhanceResult.appliedStyle, aspectRatio: enhanceResult.appliedAspectRatio, systemPrompt: enhanceResult.appliedSystemPrompt } : null,
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
