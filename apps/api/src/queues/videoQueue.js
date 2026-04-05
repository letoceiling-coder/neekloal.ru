"use strict";

const { Queue } = require("bullmq");
const { getWorkerConnection } = require("../lib/redis");

/** @type {Queue | null} */
let _videoQueue = null;

function getVideoQueue() {
  if (!_videoQueue) {
    _videoQueue = new Queue("video-generation", {
      connection: getWorkerConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return _videoQueue;
}

module.exports = { getVideoQueue };
