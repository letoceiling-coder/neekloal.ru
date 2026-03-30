"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

const USAGE_HISTORY_DEFAULT = 40;
const USAGE_HISTORY_MAX = 100;

/**
 * Тариф, остатки лимитов и последние записи usage (JWT).
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function billingRoutes(fastify) {
  fastify.get("/billing/summary", { preHandler: authMiddleware }, async (request, reply) => {
    const q = request.query && typeof request.query === "object" ? request.query : {};
    const limitRaw = q.usageHistoryLimit != null ? Number(q.usageHistoryLimit) : USAGE_HISTORY_DEFAULT;
    const historyLimit = Math.min(
      USAGE_HISTORY_MAX,
      Math.max(1, Math.floor(Number.isFinite(limitRaw) ? limitRaw : USAGE_HISTORY_DEFAULT))
    );

    const org = await prisma.organization.findFirst({
      where: { id: request.organizationId, deletedAt: null },
      include: { plan: true },
    });
    if (!org) {
      return reply.code(404).send({ error: "Organization not found" });
    }

    const maxR = org.plan.maxRequestsPerMonth;
    const maxT = org.plan.maxTokensPerMonth;

    const usageRows = await prisma.usage.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      take: historyLimit,
      select: {
        id: true,
        model: true,
        tokens: true,
        createdAt: true,
        conversationId: true,
        cost: true,
      },
    });

    const usageHistory = usageRows.map((r) => ({
      id: r.id,
      model: r.model,
      tokens: r.tokens,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      conversationId: r.conversationId,
      cost: r.cost != null ? String(r.cost) : null,
    }));

    return {
      organization: { name: org.name, slug: org.slug },
      plan: {
        name: org.plan.name,
        slug: org.plan.slug,
        maxRequestsPerMonth: maxR,
        maxTokensPerMonth: maxT,
      },
      period: {
        resetAt:
          org.resetAt instanceof Date ? org.resetAt.toISOString() : String(org.resetAt),
      },
      usage: {
        requestsUsed: org.requestsUsed,
        tokensUsed: org.tokensUsed,
        requestsRemaining: maxR != null ? Math.max(0, maxR - org.requestsUsed) : null,
        tokensRemaining: maxT != null ? Math.max(0, maxT - org.tokensUsed) : null,
      },
      limits: {
        maxFollowUpsPerConversation: (() => {
          const n = Number(process.env.WIDGET_MAX_FOLLOWUPS_PER_CONVERSATION);
          if (!Number.isFinite(n) || n < 0) {
            return 2;
          }
          return Math.min(20, Math.floor(n));
        })(),
        leadNotifyMaxPerOrgPerHour: (() => {
          const n = Number(process.env.LEAD_NOTIFY_MAX_PER_ORG_PER_HOUR);
          if (!Number.isFinite(n) || n < 1) {
            return 120;
          }
          return Math.min(10_000, Math.floor(n));
        })(),
      },
      usageHistory,
    };
  });
};
