"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");

const ADMIN_LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60 * 1000;

/**
 * Rate limit /admin/* per root user (after requireRoot).
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function adminRateLimitMiddleware(request, reply) {
  const key = `admin:${request.userId ?? "anon"}`;
  const result = await incrementAndCheck(key, ADMIN_LIMIT_PER_MINUTE, WINDOW_MS);

  if (result.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
};
