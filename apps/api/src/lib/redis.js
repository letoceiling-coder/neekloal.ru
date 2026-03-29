"use strict";

const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/** @type {import('ioredis').Redis | null} */
let _workerConn = null;

/** @type {import('ioredis').Redis | null} */
let _cacheConn = null;

/**
 * BullMQ requires maxRetriesPerRequest: null.
 * Returns the shared worker-connection, creating it on first call.
 * @returns {import('ioredis').Redis}
 */
function getWorkerConnection() {
  if (!_workerConn) {
    _workerConn = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    _workerConn.on("error", (err) => {
      // Do not crash – RAG queue will fall back to setImmediate
      process.stderr.write(`[redis:worker] ${err.message}\n`);
    });
  }
  return _workerConn;
}

/**
 * Short-lived cache connection: fast fail, no retries.
 * @returns {import('ioredis').Redis}
 */
function getCacheConnection() {
  if (!_cacheConn) {
    _cacheConn = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
      commandTimeout: 400,
      lazyConnect: true,
    });
    _cacheConn.on("error", () => {}); // silence cache errors
  }
  return _cacheConn;
}

module.exports = { getWorkerConnection, getCacheConnection, getRedisUrl: () => REDIS_URL };
