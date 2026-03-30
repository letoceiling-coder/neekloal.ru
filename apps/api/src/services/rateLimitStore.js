"use strict";

const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");

/**
 * @param {string} apiKey plain secret (Bearer value)
 * @param {number} limit max requests per window (inclusive)
 * @param {number} windowMs
 * @returns {Promise<{ count: number, resetAt: number, exceeded: boolean }>}
 */
async function incrementAndCheck(apiKey, limit, windowMs) {
  const keyHash = hashApiKey(apiKey);
  const now = Date.now();

  return prisma.$transaction(async (tx) => {
    const row = await tx.rateLimitState.findUnique({ where: { keyHash } });
    let count;
    let resetAt;

    if (!row || now >= row.resetAt.getTime()) {
      count = 1;
      resetAt = new Date(now + windowMs);
    } else {
      count = row.count + 1;
      resetAt = row.resetAt;
    }

    const exceeded = count > limit;

    await tx.rateLimitState.upsert({
      where: { keyHash },
      create: { keyHash, count, resetAt },
      update: { count, resetAt },
    });

    return {
      count,
      resetAt: resetAt.getTime(),
      exceeded,
    };
  });
}

module.exports = { incrementAndCheck };
