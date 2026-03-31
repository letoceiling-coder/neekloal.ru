"use strict";

const { Queue } = require("bullmq");
const { getWorkerConnection } = require("../lib/redis");

/** @type {Queue | null} */
let _imageQueue = null;

/**
 * Returns the shared image-generation queue (lazy init).
 * @returns {Queue}
 */
function getImageQueue() {
  if (!_imageQueue) {
    _imageQueue = new Queue("image-generation", {
      connection: getWorkerConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _imageQueue;
}

module.exports = { getImageQueue };
