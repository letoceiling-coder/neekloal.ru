"use strict";

const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * Match hostname against a domain rule ("example.com" or "*.example.com").
 * @param {string} hostname
 * @param {string} rule
 */
function hostMatchesRule(hostname, rule) {
  const h = String(hostname).toLowerCase();
  const r = String(rule).trim().toLowerCase();
  if (!r) return false;
  if (r.startsWith("*.")) {
    const base = r.slice(2);
    return h === base || h.endsWith("." + base);
  }
  return h === r;
}

/**
 * Extract hostname from Origin or Referer header.
 * @param {import('fastify').FastifyRequest} request
 * @returns {string|null}
 */
function extractRequestHost(request) {
  const origin = request.headers.origin;
  if (origin) {
    try { return new URL(String(origin)).hostname.toLowerCase(); } catch { /* */ }
  }
  const ref = request.headers.referer;
  if (ref) {
    try { return new URL(String(ref)).hostname.toLowerCase(); } catch { /* */ }
  }
  return null;
}

/**
 * Chat auth: JWT Bearer OR API key (X-Api-Key / Authorization: Bearer sk-…).
 * When using an API key with allowedDomains configured, the Origin/Referer hostname
 * must match at least one rule; otherwise → 403.
 *
 * Sets: request.userId, request.organizationId, request.apiKeyId,
 *       request.apiKey, request.assistantId
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
module.exports = async function chatAuthMiddleware(request, reply) {
  const raw = request.headers.authorization;
  const xApiKey =
    request.headers["x-api-key"] != null
      ? String(request.headers["x-api-key"]).trim()
      : "";

  let bearerToken = "";
  if (typeof raw === "string" && raw.startsWith("Bearer ")) {
    bearerToken = raw.slice("Bearer ".length).trim();
  }

  const apiKeyRaw = xApiKey.startsWith("sk-")
    ? xApiKey
    : bearerToken.startsWith("sk-")
    ? bearerToken
    : "";

  if (apiKeyRaw) {
    const keyHash = hashApiKey(apiKeyRaw);
    const record = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!record || record.deletedAt) {
      return reply.code(401).send({ error: "Unauthorized: invalid or revoked API key" });
    }

    // Domain restriction: if allowedDomains is non-empty, check Origin/Referer
    const allowed = Array.isArray(record.allowedDomains) ? record.allowedDomains : [];
    if (allowed.length > 0) {
      const host = extractRequestHost(request);
      if (!host) {
        return reply.code(403).send({
          error: "API key has domain restrictions; send Origin or Referer header",
        });
      }
      const pass = allowed.some((rule) => hostMatchesRule(host, rule));
      if (!pass) {
        return reply.code(403).send({
          error: `Domain "${host}" is not allowed for this API key`,
        });
      }
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
      if (!user) return reply.code(401).send({ error: "Unauthorized" });

      const membership = await prisma.membership.findFirst({
        where: { userId: user.id, organizationId: claims.organizationId, deletedAt: null },
      });
      if (!membership) return reply.code(401).send({ error: "Unauthorized" });

      const org = await prisma.organization.findFirst({
        where: { id: claims.organizationId, deletedAt: null },
        select: { isBlocked: true },
      });
      if (!org) return reply.code(401).send({ error: "Unauthorized" });
      if (org.isBlocked) return reply.code(403).send({ error: "Organization is blocked" });

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
