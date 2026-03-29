"use strict";

const prisma = require("../lib/prisma");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * Authorization: Bearer <JWT> only.
 * Rejects Bearer sk-… (API keys are not session tokens; use X-Api-Key on supported routes).
 *
 * Sets: request.userId, request.organizationId
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function authMiddleware(request, reply) {
  const raw = request.headers.authorization;
  if (typeof raw !== "string" || !raw.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const token = raw.slice("Bearer ".length).trim();
  if (!token) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  if (token.startsWith("sk-")) {
    return reply
      .code(401)
      .send({
        error:
          "Invalid Authorization: API keys must not be sent as Bearer. Use JWT from login, or X-Api-Key for programmatic access where supported.",
      });
  }

  try {
    const claims = verifyAccessToken(token);
    const user = await prisma.user.findFirst({
      where: { id: claims.userId, deletedAt: null },
    });
    if (!user) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const membership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: claims.organizationId,
        deletedAt: null,
      },
    });
    if (!membership) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const org = await prisma.organization.findFirst({
      where: { id: claims.organizationId, deletedAt: null },
      select: { isBlocked: true },
    });
    if (!org) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (org.isBlocked) {
      return reply.code(403).send({ error: "Organization is blocked" });
    }

    request.userId = user.id;
    request.organizationId = claims.organizationId;
  } catch {
    return reply.code(401).send({ error: "Unauthorized" });
  }
};
