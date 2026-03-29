"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");

/** API key → higher burst allowance than a personal JWT session */
const LIMIT_API_KEY = 60;
/** JWT / anonymous → lower limit */
const LIMIT_JWT = 30;
const WINDOW_MS = 60 * 1000;

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function rateLimitMiddleware(request, reply) {
  const isApiKey =
    request.apiKey != null && String(request.apiKey).trim().startsWith("sk-");
  const limit = isApiKey ? LIMIT_API_KEY : LIMIT_JWT;

  const rateKey = isApiKey
    ? request.apiKey
    : `jwt:${request.userId ?? "anon"}:${request.organizationId ?? ""}`;

  const result = await incrementAndCheck(rateKey, limit, WINDOW_MS);
  console.log("[rateLimit]", {
    prefix: `${String(rateKey).slice(0, 16)}…`,
    count: result.count,
    limit,
    resetAt: result.resetAt,
    exceeded: result.exceeded,
  });

  if (result.exceeded) {
    const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
    reply.header("Retry-After", String(Math.max(1, retryAfterSec)));
    reply.header("X-RateLimit-Limit", String(limit));
    reply.header("X-RateLimit-Remaining", "0");
    reply.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return reply.code(429).send({ error: "Too Many Requests", retryAfter: retryAfterSec });
  }

  reply.header("X-RateLimit-Limit", String(limit));
  reply.header("X-RateLimit-Remaining", String(Math.max(0, limit - result.count)));
  reply.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
};
