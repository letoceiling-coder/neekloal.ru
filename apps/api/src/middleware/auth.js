"use strict";

const { findByKey } = require("../services/apiKeysStore");

/**
 * Bearer token → request.userId
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function authMiddleware(request, reply) {
  const raw = request.headers.authorization;
  if (typeof raw !== "string" || !raw.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const key = raw.slice("Bearer ".length).trim();
  if (!key) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const record = findByKey(key);
  if (!record) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  request.userId = record.userId;
};
