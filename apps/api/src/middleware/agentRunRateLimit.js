"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");

/** Отдельный бакет от /chat: запуск движка дороже. */
const LIMIT_PER_MINUTE = 6;
const WINDOW_MS = 60 * 1000;

/**
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function agentRunRateLimit(request, reply) {
  const rateKey =
    request.apiKey != null && String(request.apiKey).trim() !== ""
      ? `agents_run:api:${request.apiKey}`
      : `agents_run:jwt:${request.userId ?? "anon"}:${request.organizationId ?? ""}`;

  const result = await incrementAndCheck(rateKey, LIMIT_PER_MINUTE, WINDOW_MS);

  if (result.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
};
