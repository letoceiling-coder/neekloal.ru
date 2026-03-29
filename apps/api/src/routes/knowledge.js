"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const qdrant = require("../lib/qdrant");
const { ingestKnowledgeDocument } = require("../services/rag");
const { addIngestJob } = require("../queue/ragQueue");

const FETCH_TIMEOUT_MS = 15_000;
const MAX_URL_CHARS = 100_000;

/**
 * Strip HTML tags and decode common entities.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract plain text from a file buffer.
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} filename
 * @returns {Promise<string>}
 */
async function extractText(buffer, mimetype, filename) {
  const ext = String(filename || "")
    .toLowerCase()
    .split(".")
    .pop();
  if (ext === "pdf" || mimetype === "application/pdf") {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return String(data.text || "").trim();
  }
  return buffer.toString("utf-8").replace(/\r\n/g, "\n").trim();
}

/**
 * Add a knowledge item to the BullMQ queue.
 * Falls back to setImmediate-based ingest if queue is unavailable.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ id: string; organizationId: string; content: string }} row
 * @param {string} assistantId
 */
async function enqueueOrIngest(fastify, row, assistantId) {
  // Try BullMQ first
  const queued = await addIngestJob(row.id)
    .then(() => {
      fastify.log.info({ knowledgeId: row.id }, "knowledge: job added to BullMQ queue");
      return true;
    })
    .catch((err) => {
      fastify.log.warn(
        { knowledgeId: row.id, err: err.message },
        "knowledge: BullMQ unavailable — falling back to direct ingest"
      );
      return false;
    });

  if (!queued) {
    // Direct background ingest (setImmediate fallback)
    setImmediate(async () => {
      if (!qdrant.isRagEnabled()) {
        await prisma.knowledge
          .update({ where: { id: row.id }, data: { status: "ready" } })
          .catch(() => {});
        return;
      }
      try {
        await ingestKnowledgeDocument(fastify, row, assistantId);
        await prisma.knowledge.update({ where: { id: row.id }, data: { status: "ready" } });
      } catch (err) {
        fastify.log.error({ knowledgeId: row.id, err: err.message }, "direct ingest failed");
        await prisma.knowledge
          .update({ where: { id: row.id }, data: { status: "failed" } })
          .catch(() => {});
      }
    });
  }
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function knowledgeRoutes(fastify) {
  // Multipart support (scoped to this plugin)
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  });

  // ─── GET /knowledge?assistantId=<id> ──────────────────────────────────────
  fastify.get("/knowledge", { preHandler: authMiddleware }, async (request) => {
    const aId =
      request.query && request.query.assistantId
        ? String(request.query.assistantId).trim()
        : null;

    const rows = await prisma.knowledge.findMany({
      where: {
        organizationId: request.organizationId,
        deletedAt: null,
        ...(aId ? { assistantId: aId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        assistantId: true,
        type: true,
        sourceName: true,
        status: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chunks: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      assistantId: r.assistantId,
      type: r.type,
      sourceName: r.sourceName ?? null,
      status: r.status,
      contentPreview: r.content ? r.content.slice(0, 300) : "",
      chunkCount: r._count.chunks,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  // ─── POST /knowledge (text) ────────────────────────────────────────────────
  fastify.post("/knowledge", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const assistantId = body.assistantId;
    const content = body.content;

    if (!assistantId || String(assistantId).trim() === "") {
      return reply.code(400).send({ error: "assistantId is required" });
    }
    if (!content) {
      return reply.code(400).send({ error: "content is required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: String(assistantId),
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) return reply.code(404).send({ error: "Assistant not found" });

    const text = String(content).trim();
    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "text",
        status: "processing",
        content: text,
      },
    });

    await enqueueOrIngest(fastify, row, assistant.id);
    return reply.code(201).send({
      id: row.id,
      assistantId: row.assistantId,
      type: row.type,
      sourceName: null,
      status: row.status,
      contentPreview: text.slice(0, 300),
      chunkCount: 0,
      createdAt: row.createdAt,
    });
  });

  // ─── POST /knowledge/upload (file: txt / pdf) ──────────────────────────────
  fastify.post("/knowledge/upload", { preHandler: authMiddleware }, async (request, reply) => {
    let assistantId = null;
    let fileInfo = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "assistantId") assistantId = String(part.value).trim();
      } else {
        // file part — read the stream into a buffer
        const chunks = [];
        for await (const chunk of part.file) chunks.push(chunk);
        fileInfo = {
          buffer: Buffer.concat(chunks),
          filename: part.filename || "upload.txt",
          mimetype: part.mimetype || "text/plain",
        };
      }
    }

    if (!assistantId) {
      return reply.code(400).send({ error: "assistantId form field required" });
    }
    if (!fileInfo || fileInfo.buffer.length === 0) {
      return reply.code(400).send({ error: "file required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: assistantId,
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) return reply.code(404).send({ error: "Assistant not found" });

    let text;
    try {
      text = await extractText(fileInfo.buffer, fileInfo.mimetype, fileInfo.filename);
    } catch (err) {
      return reply.code(422).send({ error: `Text extraction failed: ${err.message}` });
    }

    if (!text || text.trim().length < 10) {
      return reply.code(422).send({ error: "Extracted text is too short or empty" });
    }

    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "file",
        sourceName: fileInfo.filename,
        status: "processing",
        content: text,
      },
    });

    await enqueueOrIngest(fastify, row, assistant.id);
    return reply.code(202).send({
      id: row.id,
      assistantId: row.assistantId,
      type: row.type,
      sourceName: fileInfo.filename,
      status: "processing",
      contentPreview: text.slice(0, 300),
      chunkCount: 0,
      createdAt: row.createdAt,
    });
  });

  // ─── POST /knowledge/url ──────────────────────────────────────────────────
  fastify.post("/knowledge/url", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const url = body.url != null ? String(body.url).trim() : "";
    const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";

    if (!assistantId) return reply.code(400).send({ error: "assistantId is required" });
    if (!url || !/^https?:\/\//i.test(url)) {
      return reply.code(400).send({ error: "Valid http/https URL required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!assistant) return reply.code(404).send({ error: "Assistant not found" });

    // Fetch the URL
    let html;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KnowledgeBot/1.0)" },
      });
      clearTimeout(tid);
      if (!res.ok) {
        return reply.code(422).send({ error: `URL returned HTTP ${res.status}` });
      }
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text") && !ct.includes("html")) {
        return reply.code(422).send({ error: "URL must return HTML or text content" });
      }
      html = await res.text();
    } catch (err) {
      const msg =
        err.name === "AbortError"
          ? "URL fetch timed out (15s)"
          : `URL fetch error: ${err.message}`;
      return reply.code(422).send({ error: msg });
    }

    const text = htmlToText(html).slice(0, MAX_URL_CHARS);
    if (text.length < 50) {
      return reply.code(422).send({ error: "Extracted text is too short (< 50 chars)" });
    }

    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "url",
        sourceName: url,
        status: "processing",
        content: text,
      },
    });

    await enqueueOrIngest(fastify, row, assistant.id);
    return reply.code(202).send({
      id: row.id,
      assistantId: row.assistantId,
      type: row.type,
      sourceName: url,
      status: "processing",
      contentPreview: text.slice(0, 300),
      chunkCount: 0,
      createdAt: row.createdAt,
    });
  });

  // ─── POST /knowledge/reindex ─────────────────────────────────────────────
  // Force re-ingest all knowledge for an assistant into Qdrant.
  fastify.post("/knowledge/reindex", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";
    if (!assistantId) return reply.code(400).send({ error: "assistantId is required" });

    const assistant = await prisma.assistant.findFirst({
      where: { id: assistantId, organizationId: request.organizationId, deletedAt: null },
    });
    if (!assistant) return reply.code(404).send({ error: "Assistant not found" });

    const { reindexAssistant } = require("../workers/ragWorker");
    const result = await reindexAssistant(fastify, assistantId, request.organizationId);
    return reply.code(200).send(result);
  });

  // ─── DELETE /knowledge/:id ────────────────────────────────────────────────
  fastify.delete("/knowledge/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) return reply.code(400).send({ error: "id required" });

    const existing = await prisma.knowledge.findFirst({
      where: { id, organizationId: request.organizationId },
      include: { chunks: { select: { id: true, embeddingId: true } } },
    });
    if (!existing) return reply.code(404).send({ error: "Knowledge not found" });

    // Remove Qdrant points for this knowledge's chunks
    if (qdrant.isRagEnabled() && existing.chunks.length > 0) {
      const pointIds = existing.chunks.map((c) => c.embeddingId).filter(Boolean);
      await qdrant.deleteAssistantPoints(existing.assistantId, pointIds);
    }

    // Hard-delete row (cascades to knowledge_chunks)
    await prisma.knowledge.delete({ where: { id } });
    return reply.code(200).send({ ok: true });
  });
};
