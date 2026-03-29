"use strict";

const { Worker } = require("bullmq");
const prisma = require("../lib/prisma");
const { getWorkerConnection } = require("../lib/redis");
const { ingestKnowledgeDocument } = require("../services/rag");

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 min
const RECOVERY_INTERVAL_MS = 60 * 1000; // 1 min

/** @type {NodeJS.Timeout | null} */
let _recoveryTimer = null;

// ─── Core ingest logic ────────────────────────────────────────────────────────

/**
 * Fetch the knowledge item and run the full ingest pipeline.
 * Updates status to "ready" | "failed".
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} knowledgeId
 */
async function processKnowledgeItem(fastify, knowledgeId) {
  const item = await prisma.knowledge.findUnique({ where: { id: knowledgeId } });

  if (!item) {
    fastify.log.warn({ knowledgeId }, "ragWorker: item not found, skipping");
    return;
  }
  if (item.deletedAt || item.status === "ready") {
    fastify.log.info({ knowledgeId, status: item.status }, "ragWorker: item already done, skipping");
    return;
  }

  try {
    await ingestKnowledgeDocument(fastify, item, item.assistantId);
    await prisma.knowledge.update({ where: { id: item.id }, data: { status: "ready" } });
    fastify.log.info({ knowledgeId, assistantId: item.assistantId }, "ragWorker: ingest complete");
  } catch (err) {
    fastify.log.error(
      { knowledgeId, err: err instanceof Error ? err.message : String(err) },
      "ragWorker: ingest failed"
    );
    await prisma.knowledge
      .update({ where: { id: item.id }, data: { status: "failed" } })
      .catch(() => {});
    throw err; // propagate so BullMQ retries
  }
}

// ─── BullMQ worker ────────────────────────────────────────────────────────────

/**
 * Create and start the BullMQ Worker.
 * @param {import('fastify').FastifyInstance} fastify
 * @returns {import('bullmq').Worker | null}
 */
function createBullWorker(fastify) {
  let conn;
  try {
    conn = getWorkerConnection();
  } catch {
    return null;
  }

  const worker = new Worker(
    "rag-processing",
    async (job) => {
      const { knowledgeId } = job.data;
      fastify.log.info({ jobId: job.id, knowledgeId }, "ragWorker: processing BullMQ job");
      await processKnowledgeItem(fastify, knowledgeId);
    },
    { connection: conn, concurrency: 2 }
  );

  worker.on("completed", (job) => {
    fastify.log.info({ jobId: job.id, knowledgeId: job.data.knowledgeId }, "ragWorker: job completed");
  });

  worker.on("failed", (job, err) => {
    fastify.log.warn(
      { jobId: job?.id, knowledgeId: job?.data?.knowledgeId, err: err.message },
      "ragWorker: job failed (will retry)"
    );
  });

  worker.on("error", (err) => {
    fastify.log.warn({ err: err.message }, "ragWorker: worker error");
  });

  return worker;
}

// ─── Recovery polling ─────────────────────────────────────────────────────────

/**
 * Find items stuck in "processing" (older than threshold) and re-enqueue them.
 * Acts as a safety net for both BullMQ and direct-ingest paths.
 * @param {import('fastify').FastifyInstance} fastify
 */
async function runRecoveryCycle(fastify) {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await prisma.knowledge.findMany({
    where: { status: "processing", createdAt: { lt: cutoff }, deletedAt: null },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  if (stuck.length === 0) return;

  fastify.log.info({ count: stuck.length }, "ragWorker: recovering stuck items");

  const { addIngestJob } = require("../queue/ragQueue");

  for (const item of stuck) {
    // Try queue first, fall back to direct
    addIngestJob(item.id).catch(() => {
      void processKnowledgeItem(fastify, item.id).catch((e) =>
        fastify.log.error(e, "ragWorker: direct recovery failed")
      );
    });
  }
}

// ─── Reindex endpoint handler ─────────────────────────────────────────────────

/**
 * Re-queue all knowledge rows for an assistant for Qdrant re-indexing.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} assistantId
 * @param {string} organizationId
 */
async function reindexAssistant(fastify, assistantId, organizationId) {
  const items = await prisma.knowledge.findMany({
    where: { assistantId, organizationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  fastify.log.info({ assistantId, count: items.length }, "ragWorker: reindex started");

  const { addIngestJob } = require("../queue/ragQueue");

  let queued = 0;
  let direct = 0;
  let failed = 0;

  for (const item of items) {
    await prisma.knowledge
      .update({ where: { id: item.id }, data: { status: "processing" } })
      .catch(() => {});

    const jobAdded = await addIngestJob(item.id).then(() => true).catch(() => false);

    if (jobAdded) {
      queued++;
    } else {
      // BullMQ unavailable: process directly
      const ok = await processKnowledgeItem(fastify, item.id)
        .then(() => true)
        .catch(() => false);
      if (ok) direct++;
      else failed++;
    }
  }

  fastify.log.info({ assistantId, queued, direct, failed }, "ragWorker: reindex scheduled");
  return { queued, direct, failed, total: items.length };
}

// ─── Startup ──────────────────────────────────────────────────────────────────

/**
 * Start the full RAG worker system:
 *  - BullMQ worker (if Redis is reachable)
 *  - Periodic recovery polling for stuck items
 * @param {import('fastify').FastifyInstance} fastify
 */
function startWorker(fastify) {
  const qdrant = require("../lib/qdrant");
  if (!qdrant.isRagEnabled()) {
    fastify.log.info("ragWorker: Qdrant not configured — skipping worker");
    return;
  }

  // BullMQ worker (optional — falls back gracefully if Redis is down)
  let bullWorker = null;
  try {
    bullWorker = createBullWorker(fastify);
    if (bullWorker) {
      fastify.log.info({ qdrantUrl: process.env.QDRANT_URL }, "ragWorker: BullMQ worker started");
    }
  } catch (err) {
    fastify.log.warn({ err: err.message }, "ragWorker: BullMQ unavailable, using polling fallback");
  }

  // Recovery polling — always runs (handles stuck jobs regardless of BullMQ)
  setTimeout(
    () => void runRecoveryCycle(fastify).catch((e) => fastify.log.error(e, "ragWorker: initial recovery error")),
    15_000
  );
  _recoveryTimer = setInterval(
    () => void runRecoveryCycle(fastify).catch((e) => fastify.log.error(e, "ragWorker: recovery error")),
    RECOVERY_INTERVAL_MS
  );

  fastify.log.info(
    { bullmqEnabled: Boolean(bullWorker), recoveryIntervalMs: RECOVERY_INTERVAL_MS },
    "ragWorker: started"
  );
}

function stopWorker() {
  if (_recoveryTimer) {
    clearInterval(_recoveryTimer);
    _recoveryTimer = null;
  }
}

module.exports = { startWorker, stopWorker, runRecoveryCycle, reindexAssistant, processKnowledgeItem };
