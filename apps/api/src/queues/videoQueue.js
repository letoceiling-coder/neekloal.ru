"use strict";

const { Queue } = require("bullmq");
const { getWorkerConnection } = require("../lib/redis");

/** @type {Queue | null} */
let _videoQueue = null;

/**
 * Returns the shared video-generation queue (lazy init).
 * @returns {Queue}
 */
function getVideoQueue() {
  if (!_videoQueue) {
    _videoQueue = new Queue("video-generation", {
      connection: getWorkerConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 50 },
      },
    });
  }
  return _videoQueue;
}

module.exports = { getVideoQueue };
