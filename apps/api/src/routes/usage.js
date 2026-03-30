"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * @param {string} organizationId
 */
async function aggregateForOrganization(organizationId) {
  const rows = await prisma.usage.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  const totalRequests = rows.length;
  const totalTokens = rows.reduce((sum, r) => sum + r.tokens, 0);
  /** @type {Record<string, { requests: number, tokens: number }>} */
  const byModel = {};
  for (const r of rows) {
    if (!byModel[r.model]) {
      byModel[r.model] = { requests: 0, tokens: 0 };
    }
    byModel[r.model].requests += 1;
    byModel[r.model].tokens += r.tokens;
  }
  return { totalRequests, totalTokens, byModel };
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function usageRoutes(fastify) {
  fastify.get("/usage", { preHandler: authMiddleware }, async (request) => {
    return aggregateForOrganization(request.organizationId);
  });
};
