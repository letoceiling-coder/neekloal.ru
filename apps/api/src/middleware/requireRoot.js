"use strict";

const prisma = require("../lib/prisma");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * JWT Bearer only. User must exist, not deleted, and role === root.
 * Sets request.userId, request.organizationId (from token, for logging).
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function requireRoot(request, reply) {
  const raw = request.headers.authorization;
  if (typeof raw !== "string" || !raw.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const token = raw.slice("Bearer ".length).trim();
  if (!token || token.startsWith("sk-")) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  try {
    const claims = verifyAccessToken(token);
    const user = await prisma.user.findFirst({
      where: { id: claims.userId, deletedAt: null },
    });
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (user.role !== "root") {
      return reply.code(403).send({ error: "Forbidden" });
    }

    request.userId = user.id;
    request.organizationId = claims.organizationId;
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};
