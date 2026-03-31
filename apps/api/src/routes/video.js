"use strict";

const fs   = require("fs");
const path = require("path");
const { v4: uuidv4 }    = require("uuid");
const authMiddleware     = require("../middleware/auth");
const { getVideoQueue }  = require("../queues/videoQueue");
const prisma             = require("../lib/prisma");

const OUTPUT_DIR  = process.env.VIDEO_OUTPUT_DIR  || "/var/www/site-al.ru/uploads/videos";
const PREVIEW_DIR = process.env.VIDEO_PREVIEW_DIR || "/var/www/site-al.ru/uploads/videos/previews";

const VALID_MODES   = ["text", "image2video"];
const MAX_DURATION  = 8;   // seconds
const MIN_DURATION  = 1;
const VALID_FPS     = [8, 12, 16, 24];
const MAX_DIM       = 768;
const MIN_DIM       = 256;

module.exports = async function videoRoutes(fastify) {

  // ── POST /video/generate ──────────────────────────────────────────────────
  fastify.post("/video/generate", { preHandler: [authMiddleware] }, async (request, reply) => {
    const {
      prompt,
      negativePrompt,
      mode       = "text",
      imageUrl,
      width      = 512,
      height     = 512,
      fps        = 8,
      duration   = 2,
      strength   = 0.7,
    } = request.body || {};

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return reply.code(400).send({ error: "prompt is required" });
    }

    const resolvedMode = VALID_MODES.includes(mode) ? mode : "text";
    if (resolvedMode === "image2video" && !imageUrl) {
      return reply.code(400).send({ error: "imageUrl is required for image2video mode" });
    }

    const finalFps      = VALID_FPS.includes(Number(fps))  ? Number(fps) : 8;
    const finalDuration = Math.min(Math.max(Number(duration) || 2, MIN_DURATION), MAX_DURATION);
    const finalWidth    = Math.min(Math.max(Number(width)  || 512, MIN_DIM), MAX_DIM);
    const finalHeight   = Math.min(Math.max(Number(height) || 512, MIN_DIM), MAX_DIM);
    const frameCount    = Math.round(finalFps * finalDuration);

    const jobId = uuidv4();

    // Create DB record immediately (status=pending)
    try {
      await prisma.generatedVideo.create({
        data: {
          id:             uuidv4(),
          jobId,
          userId:         request.userId,
          organizationId: request.organizationId,
          status:         "pending",
          mode:           resolvedMode,
          prompt:         prompt.trim(),
          negativePrompt: negativePrompt || null,
          width:          finalWidth,
          height:         finalHeight,
          fps:            finalFps,
          frameCount,
          duration:       finalDuration,
          referenceUrl:   imageUrl || null,
        },
      });
    } catch (e) {
      process.stderr.write(`[video:generate] DB create failed: ${e.message}\n`);
    }

    // Enqueue
    const queue = getVideoQueue();
    await queue.add("generate", {
      jobId,
      prompt:         prompt.trim(),
      negativePrompt: negativePrompt || null,
      mode:           resolvedMode,
      imageUrl:       imageUrl || null,
      width:          finalWidth,
      height:         finalHeight,
      fps:            finalFps,
      duration:       finalDuration,
      strength,
      userId:         request.userId,
      organizationId: request.organizationId,
    }, { jobId });

    process.stdout.write(`[video:job] created jobId=${jobId} mode=${resolvedMode} ${finalWidth}x${finalHeight} ${finalFps}fps ${finalDuration}s\n`);

    return reply.code(202).send({
      jobId,
      status:      "queued",
      mode:        resolvedMode,
      width:       finalWidth,
      height:      finalHeight,
      fps:         finalFps,
      duration:    finalDuration,
      frameCount,
      message:     "Генерация видео начата",
    });
  });

  // ── GET /video/status/:id ─────────────────────────────────────────────────
  fastify.get("/video/status/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params;

    // Prefer DB (has most complete info)
    const record = await prisma.generatedVideo.findFirst({
      where: { OR: [{ id }, { jobId: id }], userId: request.userId },
    }).catch(() => null);

    if (record) {
      return reply.send({
        jobId:         record.jobId,
        id:            record.id,
        status:        record.status,
        mode:          record.mode,
        prompt:        record.prompt,
        width:         record.width,
        height:        record.height,
        fps:           record.fps,
        duration:      record.duration,
        frameCount:    record.frameCount,
        url:           record.url,
        previewUrl:    record.previewUrl,
        referenceUrl:  record.referenceUrl,
        error:         record.errorMessage ?? null,
        createdAt:     record.createdAt.toISOString(),
        completedAt:   record.completedAt?.toISOString() ?? null,
      });
    }

    // Fallback to BullMQ job state
    const queue = getVideoQueue();
    const job   = await queue.getJob(id);
    if (!job) return reply.code(404).send({ error: "Job not found" });

    const state  = await job.getState();
    const result = job.returnvalue;

    const response = {
      jobId:      id,
      status:     state,
      mode:       job.data.mode || "text",
      prompt:     job.data.prompt,
      width:      job.data.width,
      height:     job.data.height,
      fps:        job.data.fps,
      duration:   job.data.duration,
      createdAt:  new Date(job.timestamp).toISOString(),
    };

    if (state === "completed" && result) {
      response.url        = result.url;
      response.previewUrl = result.previewUrl;
      response.duration   = result.duration;
      response.fps        = result.fps;
      response.frameCount = result.frameCount;
    }
    if (state === "failed") {
      response.error = job.failedReason || "Video generation failed";
    }
    if (state === "active") response.progress = job.progress || 0;

    return reply.send(response);
  });

  // ── GET /video/list ───────────────────────────────────────────────────────
  fastify.get("/video/list", { preHandler: [authMiddleware] }, async (request, reply) => {
    const take = Math.min(Number(request.query?.limit) || 20, 100);

    // DB first
    try {
      const rows = await prisma.generatedVideo.findMany({
        where:   { organizationId: request.organizationId },
        orderBy: { createdAt: "desc" },
        take,
      });

      if (rows.length > 0) {
        return reply.send({
          source: "db",
          items:  rows.map((r) => ({
            id:           r.id,
            jobId:        r.jobId,
            status:       r.status,
            mode:         r.mode,
            prompt:       r.prompt,
            width:        r.width,
            height:       r.height,
            fps:          r.fps,
            duration:     r.duration,
            frameCount:   r.frameCount,
            url:          r.url,
            previewUrl:   r.previewUrl,
            referenceUrl: r.referenceUrl,
            error:        r.errorMessage ?? null,
            createdAt:    r.createdAt.toISOString(),
            completedAt:  r.completedAt?.toISOString() ?? null,
          })),
          total: rows.length,
        });
      }
    } catch (e) {
      process.stderr.write(`[video:list] DB error, fallback to BullMQ: ${e.message}\n`);
    }

    // BullMQ fallback
    const queue = getVideoQueue();
    const [completed, failed, active, waiting] = await Promise.all([
      queue.getJobs(["completed"], 0, 19),
      queue.getJobs(["failed"],    0, 4),
      queue.getJobs(["active"],    0, 4),
      queue.getJobs(["waiting"],   0, 4),
    ]);

    const toItem = (job, state) => ({
      id:         job.id,
      jobId:      job.id,
      status:     state,
      mode:       job.data?.mode || "text",
      prompt:     job.data?.prompt ?? "",
      width:      job.data?.width  ?? 512,
      height:     job.data?.height ?? 512,
      fps:        job.data?.fps    ?? 8,
      duration:   job.data?.duration ?? 2,
      url:        job.returnvalue?.url ?? null,
      previewUrl: job.returnvalue?.previewUrl ?? null,
      error:      state === "failed" ? (job.failedReason ?? "Error") : null,
      createdAt:  new Date(job.timestamp).toISOString(),
    });

    const items = [
      ...active.map((j) => toItem(j, "active")),
      ...waiting.map((j) => toItem(j, "waiting")),
      ...completed.map((j) => toItem(j, "completed")),
      ...failed.map((j) => toItem(j, "failed")),
    ].slice(0, 20);

    return reply.send({ source: "queue", items, total: items.length });
  });

  // ── DELETE /video/:id ─────────────────────────────────────────────────────
  fastify.delete("/video/:id", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params;
    if (!id || typeof id !== "string" || !id.trim()) {
      return reply.code(400).send({ error: "Invalid id" });
    }

    process.stdout.write(`[video:delete] id=${id} user=${request.userId}\n`);

    function tryUnlink(filePath) {
      if (!filePath) return false;
      try { fs.unlinkSync(filePath); return true; } catch { return false; }
    }

    let dbDeleted = false;

    // 1. Try DB
    try {
      const record = await prisma.generatedVideo.findFirst({
        where: { OR: [{ id }, { jobId: id }], organizationId: request.organizationId },
      });
      if (record) {
        tryUnlink(record.localPath);
        tryUnlink(record.previewPath);
        await prisma.generatedVideo.delete({ where: { id: record.id } });
        dbDeleted = true;
        process.stdout.write(`[video:delete] DB record deleted: ${record.id}\n`);
      }
    } catch (e) {
      process.stderr.write(`[video:delete] DB error: ${e.message}\n`);
    }

    // 2. BullMQ fallback
    if (!dbDeleted) {
      const queue = getVideoQueue();
      try {
        const job = await queue.getJob(id);
        if (job) {
          const lp = job.returnvalue?.localPath;
          if (lp) tryUnlink(lp);
          await job.remove().catch(() => {});
        }
      } catch (e) {
        process.stderr.write(`[video:delete] BullMQ error: ${e.message}\n`);
      }

      // 3. Fallback: filename pattern
      for (const ext of [".mp4", ".webm", ".gif"]) {
        tryUnlink(path.join(OUTPUT_DIR, `${id}${ext}`));
        tryUnlink(path.join(PREVIEW_DIR, `${id}.png`));
      }
    }

    return reply.send({ success: true, deleted: id });
  });
};
