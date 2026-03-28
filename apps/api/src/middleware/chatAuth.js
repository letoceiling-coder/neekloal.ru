"use strict";

const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * Chat: JWT via Authorization: Bearer &lt;JWT&gt;, OR API key via X-Api-Key: sk-…
 * Never accepts sk- in Authorization (session channel is JWT-only).
 *
 * Sets: request.userId, request.organizationId, request.apiKeyId (null if JWT)
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function chatAuthMiddleware(request, reply) {
  const raw = request.headers.authorization;
  const xApiKey =
    request.headers["x-api-key"] != null
      ? String(request.headers["x-api-key"]).trim()
      : "";

  if (typeof raw === "string" && raw.startsWith("Bearer ")) {
    const token = raw.slice("Bearer ".length).trim();
    if (!token) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    if (token.startsWith("sk-")) {
      return reply.code(401).send({
        error:
          "Do not send API keys in Authorization. Use: Authorization: Bearer <JWT> or header X-Api-Key: sk-…",
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
      request.userId = user.id;
      request.organizationId = claims.organizationId;
      request.apiKeyId = null;
      request.apiKey = null;
      return;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  }

  if (xApiKey.startsWith("sk-")) {
    const keyHash = hashApiKey(xApiKey);
    const record = await prisma.apiKey.findUnique({
      where: { keyHash },
    });
    if (!record || record.deletedAt) {
      return reply.code(401).send({ error: "Unauthorized" });
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
    request.apiKey = xApiKey;
    request.userId = actorMembership ? actorMembership.userId : null;
    return;
  }

  return reply.code(401).send({
    error: "Unauthorized: send Authorization: Bearer <JWT> or X-Api-Key: sk-…",
  });
};
