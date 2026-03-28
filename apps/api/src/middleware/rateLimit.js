"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");

const LIMIT_PER_MINUTE = 10;
const WINDOW_MS = 60 * 1000;

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function rateLimitMiddleware(request, reply) {
  const rateKey =
    request.apiKey != null && String(request.apiKey).trim() !== ""
      ? request.apiKey
      : `jwt:${request.userId ?? "anon"}:${request.organizationId ?? ""}`;

  const result = await incrementAndCheck(rateKey, LIMIT_PER_MINUTE, WINDOW_MS);
  console.log("[rateLimit]", {
    prefix: `${String(rateKey).slice(0, 16)}…`,
    count: result.count,
    resetAt: result.resetAt,
    exceeded: result.exceeded,
  });

  if (result.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
};
