"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const qdrant = require("../lib/qdrant");
const { ingestKnowledgeDocument } = require("../services/rag");
const { addIngestJob } = require("../queue/ragQueue");
const { detectIntent } = require("../services/intentDetector");

const FETCH_TIMEOUT_MS = 15_000;
const MAX_URL_CHARS = 100_000;

/**
 * Maps stem keywords in a filename (without extension) to an intent label.
 * Priority: exact match → substring match.
 */
const FILENAME_INTENT_MAP = [
  { keywords: ["pricing", "price", "prices", "ценник", "стоимость", "цена"],    intent: "pricing" },
  { keywords: ["objection", "objections", "возражени"],                         intent: "objection" },
  { keywords: ["qualification", "qualify", "квалифика"],                        intent: "qualification_site" },
  { keywords: ["close", "closing", "сделка"],                                   intent: "close" },
];

/**
 * Resolve the intent for a knowledge item using a priority chain:
 *   1. explicit  – value passed directly in body/form ("pricing", "objection", …)
 *   2. filename  – stem of the uploaded filename  (pricing.txt → "pricing")
 *   3. text      – detectIntent() on the content  (keyword scan)
 *
 * Returns null when intent cannot be determined (avoids storing "unknown").
 *
 * @param {string|null|undefined} explicit   Caller-supplied intent override.
 * @param {string|null|undefined} filename   Original file / source name.
 * @param {string}                text       Extracted content.
 * @returns {string|null}
 */
function resolveIntent(explicit, filename, text) {
  // 1. Explicit override wins unconditionally
  const e = String(explicit ?? "").trim().toLowerCase();
  if (e && e !== "unknown") return e;

  // 2. Filename-based detection (stem without extension, lowercased)
  const stem = String(filename ?? "")
    .replace(/\.[^.]+$/, "")   // strip extension
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")  // normalise separators
    .trim();
  if (stem) {
    for (const { keywords, intent } of FILENAME_INTENT_MAP) {
      if (keywords.some((k) => stem === k || stem.includes(k))) return intent;
    }
  }

  // 3. Content-level detection
  const detected = detectIntent(text).intent;
  return detected === "unknown" ? null : detected;
}

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
  // Multipart: many files per request (files[]), 10 MB each, up to 64 files
  await fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 10 * 1024 * 1024, files: 64, fields: 10 },
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
        intent: true,
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
      intent: r.intent ?? null,
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
    // Priority: body.intent → detectIntent(text)
    const intent = resolveIntent(body.intent, null, text);
    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "text",
        status: "processing",
        content: text,
        intent,
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

  /**
   * Multipart file field names: single legacy `file`, or multiple `files` / `files[]`.
   * @param {string} fieldname
   * @returns {boolean}
   */
  function isKnowledgeUploadFileField(fieldname) {
    const n = String(fieldname || "");
    return n === "file" || n === "files" || n === "files[]" || n === "file[]";
  }

  // ─── POST /knowledge/upload (one or many files: txt / pdf) ─────────────────
  fastify.post("/knowledge/upload", { preHandler: authMiddleware }, async (request, reply) => {
    let assistantId = null;
    let explicitIntent = null; // optional "intent" form field
    /** @type {{ buffer: Buffer; filename: string; mimetype: string }[]} */
    const fileInfos = [];

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "assistantId") assistantId = String(part.value ?? "").trim();
        if (part.fieldname === "intent") explicitIntent = String(part.value ?? "").trim() || null;
      } else if (isKnowledgeUploadFileField(part.fieldname)) {
        // Use toBuffer() — more reliable than manual chunk iteration in @fastify/multipart v9
        const buffer = await part.toBuffer();
        console.log("[upload] part received:", part.fieldname, part.filename, "size:", buffer.length);
        if (buffer.length > 0) {
          fileInfos.push({
            buffer,
            filename: part.filename || "upload.txt",
            mimetype: part.mimetype || "text/plain",
          });
        }
      } else {
        // Drain any unexpected file stream so the iterator can advance
        if (typeof part.toBuffer === "function") await part.toBuffer().catch(() => {});
      }
    }

    console.log("[upload] files collected:", fileInfos.length, "assistantId:", assistantId);

    if (!assistantId) {
      return reply.code(400).send({ error: "assistantId form field required" });
    }
    if (fileInfos.length === 0) {
      return reply.code(400).send({ error: "At least one file is required (files[] or file)" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: assistantId,
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) return reply.code(404).send({ error: "Assistant not found" });

    /** @type {object[]} */
    const items = [];
    /** @type {{ sourceName: string; error: string }[]} */
    const errors = [];

    for (const fileInfo of fileInfos) {
      const sourceName = fileInfo.filename;
      let text;
      try {
        text = await extractText(fileInfo.buffer, fileInfo.mimetype, fileInfo.filename);
      } catch (err) {
        errors.push({ sourceName, error: `Text extraction failed: ${err.message}` });
        continue;
      }

      if (!text || text.trim().length < 10) {
        errors.push({ sourceName, error: "Extracted text is too short or empty" });
        continue;
      }

      // Priority: explicit form field → filename stem → detectIntent(text)
      const intent = resolveIntent(explicitIntent, sourceName, text);
      const row = await prisma.knowledge.create({
        data: {
          organizationId: request.organizationId,
          assistantId: assistant.id,
          type: "file",
          sourceName,
          status: "processing",
          content: text,
          intent,
        },
      });

      await enqueueOrIngest(fastify, row, assistant.id);
      items.push({
        id: row.id,
        assistantId: row.assistantId,
        type: row.type,
        sourceName,
        status: row.status,
        contentPreview: text.slice(0, 300),
        chunkCount: 0,
        createdAt: row.createdAt,
      });
    }

    if (items.length === 0) {
      return reply.code(422).send({ items: [], errors });
    }

    return reply.code(202).send({ items, errors });
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

    // Use URL pathname as the "filename" hint (e.g. /pricing.html → pricing)
    let urlPath = "";
    try { urlPath = new URL(url).pathname; } catch (_) {}
    // Priority: body.intent → URL path → detectIntent(text)
    const intent = resolveIntent(body.intent, urlPath, text);
    const row = await prisma.knowledge.create({
      data: {
        organizationId: request.organizationId,
        assistantId: assistant.id,
        type: "url",
        sourceName: url,
        status: "processing",
        content: text,
        intent,
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

  // ─── GET /knowledge/:id ───────────────────────────────────────────────────
  fastify.get("/knowledge/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) return reply.code(400).send({ error: "id required" });

    const row = await prisma.knowledge.findFirst({
      where: { id, organizationId: request.organizationId },
      select: {
        id: true, assistantId: true, type: true, sourceName: true,
        status: true, intent: true, content: true, contentPreview: true,
        chunkCount: true, createdAt: true, updatedAt: true,
      },
    });
    if (!row) return reply.code(404).send({ error: "Knowledge not found" });
    return row;
  });

  // ─── PATCH /knowledge/:id ─────────────────────────────────────────────────
  fastify.patch("/knowledge/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) return reply.code(400).send({ error: "id required" });

    const body = request.body && typeof request.body === "object" ? request.body : {};
    /** @type {import('@prisma/client').Prisma.KnowledgeUpdateInput} */
    const data = {};

    if (body.content != null) {
      const content = String(body.content).trim();
      if (!content) return reply.code(400).send({ error: "content cannot be empty" });
      data.content = content;
      data.contentPreview = content.slice(0, 200);
      data.status = "processing"; // will re-ingest
    }
    if (body.intent !== undefined) {
      data.intent = body.intent ? String(body.intent).trim() : null;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existing = await prisma.knowledge.findFirst({
      where: { id, organizationId: request.organizationId },
    });
    if (!existing) return reply.code(404).send({ error: "Knowledge not found" });

    const updated = await prisma.knowledge.update({ where: { id }, data });

    // Re-ingest if content changed
    if (body.content != null) {
      await enqueueOrIngest(fastify, { id, organizationId: request.organizationId, content: data.content }, existing.assistantId);
    }

    return updated;
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
