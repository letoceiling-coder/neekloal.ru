"use strict";

const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * Chat: JWT via Authorization: Bearer <JWT>, OR API key via:
 *   - X-Api-Key: sk-…
 *   - Authorization: Bearer sk-… (widget convenience)
 *
 * Sets: request.userId, request.organizationId, request.apiKeyId, request.assistantId
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function chatAuthMiddleware(request, reply) {
  const raw = request.headers.authorization;
  const xApiKey =
    request.headers["x-api-key"] != null
      ? String(request.headers["x-api-key"]).trim()
      : "";

  // Extract any Bearer token (could be JWT or sk-)
  let bearerToken = "";
  if (typeof raw === "string" && raw.startsWith("Bearer ")) {
    bearerToken = raw.slice("Bearer ".length).trim();
  }

  // Determine which credential to use: prefer X-Api-Key, then Bearer sk-, then Bearer JWT
  const apiKeyRaw = xApiKey.startsWith("sk-")
    ? xApiKey
    : bearerToken.startsWith("sk-")
    ? bearerToken
    : "";

  if (apiKeyRaw) {
    const keyHash = hashApiKey(apiKeyRaw);
    const record = await prisma.apiKey.findUnique({
      where: { keyHash },
    });
    if (!record || record.deletedAt) {
      return reply.code(401).send({ error: "Unauthorized: invalid or revoked API key" });
    }

    const orgForKey = await prisma.organization.findFirst({
      where: { id: record.organizationId, deletedAt: null },
      select: { isBlocked: true },
    });
    if (!orgForKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (orgForKey.isBlocked) {
      return reply.code(403).send({ error: "Organization is blocked" });
    }

    let actorMembership = await prisma.membership.findFirst({
      where: { organizationId: record.organizationId, deletedAt: null, role: "OWNER" },
    });
    if (!actorMembership) {
      actorMembership = await prisma.membership.findFirst({
        where: { organizationId: record.organizationId, deletedAt: null },
        orderBy: { createdAt: "asc" },
      });
    }

    request.organizationId = record.organizationId;
    request.apiKeyId = record.id;
    request.apiKey = apiKeyRaw;
    request.userId = actorMembership ? actorMembership.userId : null;
    request.assistantId = record.assistantId || null;
    return;
  }

  // JWT path
  if (bearerToken && !bearerToken.startsWith("sk-")) {
    try {
      const claims = verifyAccessToken(bearerToken);
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
      request.apiKeyId = null;
      request.apiKey = null;
      request.assistantId = null;
      return;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  }

  return reply.code(401).send({
    error: "Unauthorized: send Authorization: Bearer <JWT> or X-Api-Key: sk-…",
  });
};
