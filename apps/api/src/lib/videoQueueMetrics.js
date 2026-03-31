"use strict";

/**
 * Simple ETA model: each waiting slot ahead of the job costs AVG_JOB_TIME_SEC.
 * GPU worker concurrency is capped (default 1) so queue is serial per slot.
 */
const AVG_JOB_TIME_SEC = Math.max(5, Math.min(600, Number(process.env.VIDEO_QUEUE_AVG_JOB_SEC) || 30));

/** Max parallel GPU jobs from this worker process (hard cap 2 — do not overload GPU). */
const MAX_VIDEO_CONCURRENCY = Math.min(2, Math.max(1, Number(process.env.VIDEO_WORKER_CONCURRENCY) || 1));

/**
 * Map DB/Bull statuses to API-facing statuses for the frontend.
 * @param {string} status
 * @returns {"queued"|"processing"|"completed"|"failed"}
 */
function mapDbStatusToApi(status) {
  if (status === "pending" || status === "waiting" || status === "delayed") return "queued";
  if (status === "running" || status === "active") return "processing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "queued";
}

/**
 * @param {import("bullmq").Queue} queue
 * @param {string} jobId BullMQ job id (same as business jobId UUID)
 * @returns {Promise<{ position: number | null, eta: number | null, progress: number | null, bullState: string | null }>}
 */
async function getQueuePositionAndEta(queue, jobId) {
  const job = await queue.getJob(jobId);
  if (!job) {
    return { position: null, eta: null, progress: null, bullState: null };
  }

  const [state, progressVal] = await Promise.all([job.getState(), job.progress]);
  const progress = typeof progressVal === "number" ? progressVal : null;

  if (state === "completed" || state === "failed") {
    return { position: null, eta: null, progress: state === "completed" ? 100 : progress, bullState: state };
  }

  if (state === "active") {
    return { position: 0, eta: 0, progress, bullState: "active" };
  }

  const [waiting, delayed] = await Promise.all([queue.getWaiting(), queue.getDelayed()]);

  const idxW = waiting.findIndex((j) => j.id === jobId);
  if (idxW >= 0) {
    return {
      position: idxW,
      eta: idxW * AVG_JOB_TIME_SEC,
      progress,
      bullState: "waiting",
    };
  }

  const idxD = delayed.findIndex((j) => j.id === jobId);
  if (idxD >= 0) {
    const position = waiting.length + idxD;
    return {
      position,
      eta: position * AVG_JOB_TIME_SEC,
      progress,
      bullState: "delayed",
    };
  }

  return { position: null, eta: null, progress, bullState: state };
}

module.exports = {
  AVG_JOB_TIME_SEC,
  MAX_VIDEO_CONCURRENCY,
  mapDbStatusToApi,
  getQueuePositionAndEta,
};
