"use strict";

const prisma = require("../lib/prisma");
const qdrant = require("../lib/qdrant");
const { ingestKnowledgeDocument } = require("../services/rag");

/** Items stuck in "processing" longer than 5 minutes are retried. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

/** Periodic check interval. */
const INTERVAL_MS = 60 * 1000;

/** @type {NodeJS.Timeout | null} */
let workerTimer = null;

/**
 * Ingest a single knowledge item and update its status.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ id: string; assistantId: string; organizationId: string; content: string }} item
 */
async function processItem(fastify, item) {
  try {
    await ingestKnowledgeDocument(fastify, item, item.assistantId);
    await prisma.knowledge.update({ where: { id: item.id }, data: { status: "ready" } });
    fastify.log.info({ knowledgeId: item.id, assistantId: item.assistantId }, "ragWorker: ingest complete");
    return true;
  } catch (err) {
    fastify.log.warn(
      { knowledgeId: item.id, err: err instanceof Error ? err.message : String(err) },
      "ragWorker: ingest failed"
    );
    await prisma.knowledge
      .update({ where: { id: item.id }, data: { status: "failed" } })
      .catch(() => {});
    return false;
  }
}

/**
 * Find and re-process knowledge items stuck in "processing" state.
 * @param {import('fastify').FastifyInstance} fastify
 */
async function runWorkerCycle(fastify) {
  if (!qdrant.isRagEnabled()) return;

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await prisma.knowledge.findMany({
    where: { status: "processing", createdAt: { lt: cutoff }, deletedAt: null },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  if (stuck.length > 0) {
    fastify.log.info({ count: stuck.length }, "ragWorker: retrying stuck items");
    for (const item of stuck) {
      await processItem(fastify, item);
    }
  }
}

/**
 * Re-index all knowledge rows for a given assistant.
 * Called by the /knowledge/reindex endpoint.
 * @param {import('fastify').FastifyInstance} fastify
 * @param {string} assistantId
 * @param {string} organizationId
 * @returns {Promise<{ reindexed: number; failed: number }>}
 */
async function reindexAssistant(fastify, assistantId, organizationId) {
  const items = await prisma.knowledge.findMany({
    where: { assistantId, organizationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  fastify.log.info(
    { assistantId, count: items.length },
    "ragWorker: reindex started"
  );

  let reindexed = 0;
  let failed = 0;

  for (const item of items) {
    // Mark as processing before ingesting
    await prisma.knowledge
      .update({ where: { id: item.id }, data: { status: "processing" } })
      .catch(() => {});
    const ok = await processItem(fastify, item);
    if (ok) reindexed++;
    else failed++;
  }

  fastify.log.info({ assistantId, reindexed, failed }, "ragWorker: reindex complete");
  return { reindexed, failed };
}

/**
 * Start the background RAG worker.
 * Called once after server starts listening.
 * @param {import('fastify').FastifyInstance} fastify
 */
function startWorker(fastify) {
  if (!qdrant.isRagEnabled()) {
    fastify.log.info("ragWorker: QDRANT_URL not set — worker disabled");
    return;
  }

  // Initial stuck-item recovery after 15 seconds
  setTimeout(
    () =>
      void runWorkerCycle(fastify).catch((e) =>
        fastify.log.error(e, "ragWorker: initial cycle error")
      ),
    15_000
  );

  // Periodic check every minute
  workerTimer = setInterval(
    () =>
      void runWorkerCycle(fastify).catch((e) =>
        fastify.log.error(e, "ragWorker: cycle error")
      ),
    INTERVAL_MS
  );

  fastify.log.info(
    { intervalMs: INTERVAL_MS, qdrantUrl: process.env.QDRANT_URL },
    "ragWorker: started"
  );
}

/**
 * Stop the background worker (for graceful shutdown).
 */
function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

module.exports = { startWorker, stopWorker, runWorkerCycle, reindexAssistant, processItem };
