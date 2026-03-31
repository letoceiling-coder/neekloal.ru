"use strict";

/**
 * avito.queue.js — BullMQ queue + worker for Avito message processing.
 *
 * Queue name: "avito-messages"
 *
 * Job payload:
 *   { agentId, eventId, chatId, authorId, text, messageId, rawEvent }
 *
 * Worker is embedded in the main API process (lightweight, no GPU).
 */

const { Queue, Worker } = require("bullmq");
const { getWorkerConnection } = require("../../lib/redis");

const QUEUE_NAME = "avito-messages";

/** @type {Queue | null} */
let _queue = null;

/** @type {Worker | null} */
let _worker = null;

/**
 * Returns the shared Avito message queue (lazy init).
 * Falls back to null if Redis is unavailable (permissive degradation).
 * @returns {Queue | null}
 */
function getAvitoQueue() {
  if (_queue) return _queue;
  try {
    _queue = new Queue(QUEUE_NAME, {
      connection: getWorkerConnection(),
      defaultJobOptions: {
        attempts:        2,                                 // 1 initial + 1 retry
        backoff:         { type: "exponential", delay: 3_000 },
        removeOnComplete: { count: 500 },
        removeOnFail:    { count: 200 },
      },
    });
    _queue.on("error", (err) => {
      process.stderr.write(`[avito:queue] Queue error: ${err.message}\n`);
    });
  } catch (err) {
    process.stderr.write(`[avito:queue] init failed (Redis unavailable?): ${err.message}\n`);
    _queue = null;
  }
  return _queue;
}

/**
 * Start the BullMQ worker that processes Avito messages.
 * Called once from app.js after the server starts.
 * @param {Function} processorFn   Job processor — import from avito.processor.js
 * @returns {Worker | null}
 */
function startAvitoWorker(processorFn) {
  if (_worker) return _worker;
  try {
    _worker = new Worker(QUEUE_NAME, processorFn, {
      connection: getWorkerConnection(),
      concurrency: 3,           // process up to 3 Avito messages in parallel
    });

    _worker.on("completed", (job) => {
      process.stdout.write(`[avito:worker] ✓ job=${job.id} chatId=${job.data?.chatId}\n`);
    });
    _worker.on("failed", (job, err) => {
      process.stderr.write(
        `[avito:worker] ✗ job=${job?.id} chatId=${job?.data?.chatId} err="${err.message}"\n`
      );
    });
    _worker.on("error", (err) => {
      process.stderr.write(`[avito:worker] worker error: ${err.message}\n`);
    });

    process.stdout.write(`[avito:worker] BullMQ worker started (queue="${QUEUE_NAME}" concurrency=3)\n`);
  } catch (err) {
    process.stderr.write(`[avito:worker] failed to start: ${err.message}\n`);
    _worker = null;
  }
  return _worker;
}

module.exports = { getAvitoQueue, startAvitoWorker, QUEUE_NAME };
