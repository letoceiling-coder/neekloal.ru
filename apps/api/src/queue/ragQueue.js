"use strict";

const { Queue } = require("bullmq");
const { getWorkerConnection } = require("../lib/redis");

/** @type {import('bullmq').Queue | null} */
let _queue = null;
let _queueFailed = false;

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 100 },
};

/**
 * Returns the shared RAG processing queue, or null if Redis is unavailable.
 * @returns {import('bullmq').Queue | null}
 */
function getRagQueue() {
  if (_queueFailed) return null;
  if (_queue) return _queue;

  try {
    _queue = new Queue("rag-processing", {
      connection: getWorkerConnection(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    return _queue;
  } catch (err) {
    _queueFailed = true;
    process.stderr.write(`[ragQueue] failed to create queue: ${err.message}\n`);
    return null;
  }
}

/**
 * Add a knowledge-ingest job to the queue.
 * Throws if the queue is unavailable so callers can fall back.
 * @param {string} knowledgeId
 * @param {object} [opts] Optional BullMQ job options
 */
async function addIngestJob(knowledgeId, opts) {
  const queue = getRagQueue();
  if (!queue) throw new Error("RAG queue unavailable");
  return queue.add("ingest", { knowledgeId }, opts ?? DEFAULT_JOB_OPTIONS);
}

module.exports = { getRagQueue, addIngestJob };
