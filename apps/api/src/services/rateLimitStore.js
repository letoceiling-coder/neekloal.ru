"use strict";

const { getCacheConnection } = require("../lib/redis");
const { hashApiKey } = require("../lib/apiKeyHash");

/**
 * Redis-backed rate limit counter.
 * Uses SET NX EX + INCR + TTL pipeline — no Postgres, no transactions.
 *
 * @param {string} rateKey  plain identity key (apiKey or "jwt:userId:orgId")
 * @param {number} limit    max requests per window (inclusive)
 * @param {number} windowMs window duration in ms
 * @returns {Promise<{ count: number, resetAt: number, exceeded: boolean }>}
 */
async function incrementAndCheck(rateKey, limit, windowMs) {
  const keyHash = hashApiKey(String(rateKey));
  const redisKey = `rl:${keyHash}`;
  const windowSec = Math.ceil(windowMs / 1000);

  try {
    const redis = getCacheConnection();

    // Three-command pipeline (single round-trip):
    // 1. SET redisKey 0 EX windowSec NX  — initialize counter with TTL only on first hit
    // 2. INCR redisKey                   — atomic increment
    // 3. TTL  redisKey                   — read remaining TTL for Retry-After header
    const [[, ], [incrErr, count], [ttlErr, ttl]] = await redis
      .pipeline()
      .set(redisKey, 0, "EX", windowSec, "NX")
      .incr(redisKey)
      .ttl(redisKey)
      .exec();

    if (incrErr) throw incrErr;

    const remaining = !ttlErr && ttl > 0 ? ttl : windowSec;
    const resetAt = Date.now() + remaining * 1000;
    const exceeded = count > limit;

    console.log("[rateLimit:redis]", {
      key: redisKey.slice(0, 20) + "…",
      count,
      limit,
      exceeded,
    });

    return { count, resetAt, exceeded };
  } catch (err) {
    // Redis unavailable → fail-open (do not block the request)
    console.error("[rateLimit:redis] fail-open:", err.message);
    return { count: 0, resetAt: Date.now() + windowMs, exceeded: false };
  }
}

module.exports = { incrementAndCheck };
