"use strict";

const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");

/**
 * Bearer token → request.userId, request.apiKey, request.apiKeyId
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
  const keyHash = hashApiKey(key);
  const record = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!record) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  request.userId = record.userId;
  request.apiKey = key;
  request.apiKeyId = record.id;
};
