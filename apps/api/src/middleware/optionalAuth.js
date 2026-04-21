"use strict";

const prisma = require("../lib/prisma");
const { verifyAccessToken } = require("../lib/jwt");

/**
 * If `Authorization: Bearer <JWT>` is valid, sets request.userId and request.organizationId.
 * Does not send 401 when missing/invalid — used for optional org-scoped data (e.g. model catalog).
 */
module.exports = async function optionalAuthMiddleware(request, _reply) {
  const raw = request.headers.authorization;
  if (typeof raw !== "string" || !raw.startsWith("Bearer ")) return;
  const token = raw.slice("Bearer ".length).trim();
  if (!token || token.startsWith("sk-")) return;

  try {
    const claims = verifyAccessToken(token);
    const membership = await prisma.membership.findFirst({
      where: {
        userId:         claims.userId,
        organizationId: claims.organizationId,
        deletedAt:      null,
      },
    });
    if (!membership) return;

    const org = await prisma.organization.findFirst({
      where: { id: claims.organizationId, deletedAt: null },
      select: { isBlocked: true },
    });
    if (!org || org.isBlocked) return;

    request.userId         = claims.userId;
    request.organizationId = claims.organizationId;
  } catch {
    /* ignore */
  }
};
