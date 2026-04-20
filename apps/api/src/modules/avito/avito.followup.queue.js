"use strict";

/**
 * avito.followup.queue.js — BullMQ queue + worker for Avito follow-up sequences.
 *
 * Queue name: "avito-followup"
 *
 * Job payload:
 *   { followUpId, agentId, chatId, leadId, step }
 *
 * Schedule (delays after each inbound message):
 *   step 1 →  5 min
 *   step 2 → 15 min
 *   step 3 → 60 min
 *
 * On new inbound message all pending follow-ups for that chat are cancelled
 * (both in DB and removed from BullMQ queue).
 */

const { Queue, Worker } = require("bullmq");
const { getWorkerConnection } = require("../../lib/redis");
const prisma = require("../../lib/prisma");
const { resolveFollowUpSequence } = require("../../services/followupTemplates");

const QUEUE_NAME = "avito-followup";

/**
 * Hard-coded fallback used only when resolveFollowUpSequence() fails or the
 * lead/org cannot be resolved (defensive — see scheduleFollowUps).
 * The canonical defaults live in services/followupTemplates.js::DEFAULT_SEQUENCE.
 */
const STEPS = [
  { step: 1, delayMs:  5 * 60 * 1000 },  //  5 min
  { step: 2, delayMs: 15 * 60 * 1000 },  // 15 min
  { step: 3, delayMs: 60 * 60 * 1000 },  // 60 min
];

/** @type {Queue | null} */
let _queue = null;

/** @type {Worker | null} */
let _worker = null;

// ── Queue singleton ───────────────────────────────────────────────────────────

function getFollowUpQueue() {
  if (_queue) return _queue;
  try {
    _queue = new Queue(QUEUE_NAME, {
      connection: getWorkerConnection(),
      defaultJobOptions: {
        attempts:         1,
        removeOnComplete: { count: 300 },
        removeOnFail:     { count: 100 },
      },
    });
    _queue.on("error", (err) => {
      process.stderr.write(`[followup:queue] error: ${err.message}\n`);
    });
  } catch (err) {
    process.stderr.write(`[followup:queue] init failed: ${err.message}\n`);
    _queue = null;
  }
  return _queue;
}

// ── Scheduler — called after each inbound Avito message ──────────────────────

/**
 * Cancel all pending follow-ups for a chat (DB + BullMQ), then schedule new sequence.
 *
 * @param {{
 *   agentId:  string,
 *   chatId:   string,
 *   leadId:   string,
 * }} params
 */
async function scheduleFollowUps({ agentId, chatId, leadId }) {
  const queue = getFollowUpQueue();
  if (!queue) {
    process.stderr.write(`[followup:schedule] queue unavailable — skipping chatId=${chatId}\n`);
    return;
  }

  // ── 1. Cancel existing pending follow-ups ────────────────────────────────
  await cancelFollowUps({ agentId, chatId, reason: "new message" });

  // ── 2. Resolve per-org sequence (falls back to hard-coded defaults) ──────
  let sequence = STEPS;
  try {
    const agent = await prisma.agent.findUnique({
      where:  { id: agentId },
      select: { organizationId: true },
    });
    if (agent?.organizationId) {
      const seq = await resolveFollowUpSequence(agent.organizationId);
      if (Array.isArray(seq) && seq.length > 0) {
        sequence = seq.map((s) => ({ step: s.step, delayMs: s.delayMs }));
      }
    }
  } catch (err) {
    process.stderr.write(
      `[followup:schedule] resolveFollowUpSequence failed agentId=${agentId}: ${err.message}\n`
    );
  }

  // ── 3. Create DB rows + enqueue BullMQ jobs ──────────────────────────────
  const now = Date.now();

  for (const { step, delayMs } of sequence) {
    const scheduledAt = new Date(now + delayMs);

    // Create DB record first to get the id
    const fu = await prisma.avitoFollowUp.create({
      data: {
        agentId,
        chatId,
        leadId,
        step,
        status:      "pending",
        scheduledAt,
      },
    });

    // Enqueue with delay — job name includes step for deduplication
    await queue.add(
      `followup:step${step}`,
      { followUpId: fu.id, agentId, chatId, leadId, step },
      { delay: delayMs, jobId: `fu-${fu.id}` }
    );

    process.stdout.write(
      `[followup:schedule] step=${step} chatId=${chatId} delay=${Math.round(delayMs / 60000)}min ` +
      `fuId=${fu.id}\n`
    );
  }
}

// ── Cancel logic ──────────────────────────────────────────────────────────────

/**
 * Cancel all pending follow-ups for a chat.
 * Marks DB rows as "cancelled" and removes BullMQ delayed jobs.
 *
 * @param {{ agentId: string, chatId: string, reason?: string }} params
 */
async function cancelFollowUps({ agentId, chatId, reason = "cancelled" }) {
  const queue = getFollowUpQueue();

  // Load all pending follow-ups for this chat
  const pending = await prisma.avitoFollowUp.findMany({
    where: { agentId, chatId, status: "pending" },
  });

  if (!pending.length) return;

  // Mark as cancelled in DB
  await prisma.avitoFollowUp.updateMany({
    where: { id: { in: pending.map((f) => f.id) } },
    data:  { status: "cancelled" },
  });

  // Remove from BullMQ queue
  if (queue) {
    for (const fu of pending) {
      try {
        const job = await queue.getJob(`fu-${fu.id}`);
        if (job) await job.remove();
      } catch { /* ignore removal errors */ }
    }
  }

  process.stdout.write(
    `[followup:cancel] cancelled=${pending.length} chatId=${chatId} reason="${reason}"\n`
  );
}

// ── Worker ────────────────────────────────────────────────────────────────────

/**
 * Start the BullMQ worker for follow-up processing.
 * @param {Function} processorFn  imported from avito.followup.processor.js
 * @returns {Worker | null}
 */
function startFollowUpWorker(processorFn) {
  if (_worker) return _worker;
  try {
    _worker = new Worker(QUEUE_NAME, processorFn, {
      connection:  getWorkerConnection(),
      concurrency: 5,
    });

    _worker.on("completed", (job) => {
      process.stdout.write(
        `[followup:worker] ✓ job=${job.id} step=${job.data?.step} chatId=${job.data?.chatId}\n`
      );
    });
    _worker.on("failed", (job, err) => {
      process.stderr.write(
        `[followup:worker] ✗ job=${job?.id} step=${job?.data?.step} err="${err.message}"\n`
      );
    });
    _worker.on("error", (err) => {
      process.stderr.write(`[followup:worker] error: ${err.message}\n`);
    });

    process.stdout.write(
      `[followup:worker] BullMQ worker started (queue="${QUEUE_NAME}" concurrency=5)\n`
    );
  } catch (err) {
    process.stderr.write(`[followup:worker] failed to start: ${err.message}\n`);
    _worker = null;
  }
  return _worker;
}

module.exports = {
  getFollowUpQueue,
  scheduleFollowUps,
  cancelFollowUps,
  startFollowUpWorker,
  QUEUE_NAME,
};
