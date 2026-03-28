"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");

const LIMIT_PER_MINUTE = 10;
const WINDOW_MS = 60 * 1000;

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function rateLimitMiddleware(request, reply) {
  const apiKey = request.apiKey;
  if (!apiKey) {
    return reply.code(500).send({ error: "Rate limit requires apiKey" });
  }

  const result = await incrementAndCheck(apiKey, LIMIT_PER_MINUTE, WINDOW_MS);
  console.log("[rateLimit]", {
    apiKeyPrefix: `${apiKey.slice(0, 12)}…`,
    count: result.count,
    resetAt: result.resetAt,
    exceeded: result.exceeded,
  });

  if (result.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
};
