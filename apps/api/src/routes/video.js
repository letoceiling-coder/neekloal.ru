"use strict";

const authMiddleware = require("../middleware/auth");
const prisma = require("../lib/prisma");
const { createAndEnqueueVideoJob } = require("../services/videoGeneration");

module.exports = async function videoRoutes(fastify) {
  fastify.post(
    "/generate",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const body = typeof request.body === "object" && request.body ? request.body : {};
      const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      const script = typeof body.script === "string" ? body.script.trim() : "";
      const voiceText =
        body.voiceText != null && String(body.voiceText).trim()
          ? String(body.voiceText).trim()
          : undefined;

      const modeRaw = body.mode != null ? String(body.mode).trim().toLowerCase() : "";
      const mode = modeRaw === "standard" ? "standard" : "ltx";

      if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
        return reply.code(400).send({ error: "imageUrl must be a valid http(s) URL" });
      }
      if (!script) {
        return reply.code(400).send({ error: "script is required" });
      }

      try {
        const row = await createAndEnqueueVideoJob({
          userId: request.userId,
          organizationId: request.organizationId,
          imageUrl,
          script,
          voiceText,
          mode,
          notify: null,
        });
        return reply.code(202).send({
          jobId: row.id,
          status: row.status,
          mode: row.mode,
        });
      } catch (e) {
        request.log.error(e);
        return reply.code(500).send({ error: e.message || "enqueue_failed" });
      }
    }
  );

  fastify.get(
    "/status/:jobId",
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const jobId = request.params && request.params.jobId ? String(request.params.jobId).trim() : "";
      if (!jobId) return reply.code(400).send({ error: "jobId required" });

      const row = await prisma.videoGenerationJob.findFirst({
        where: {
          id: jobId,
          userId: request.userId,
          organizationId: request.organizationId,
        },
      });
      if (!row) return reply.code(404).send({ error: "not found" });

      return reply.send({
        jobId: row.id,
        status: row.status,
        mode: row.mode,
        outputUrl: row.outputUrl,
        error: row.error,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  );
};
