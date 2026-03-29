"use strict";

const prisma = require("../lib/prisma");

/**
 * First instant of the next calendar month (UTC).
 * @param {Date} [date]
 * @returns {Date}
 */
function startOfNextCalendarMonthUTC(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
}

/**
 * @returns {Date}
 */
function getInitialResetAt() {
  return startOfNextCalendarMonthUTC(new Date());
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function safeTokenCount(n) {
  if (n == null) return 0;
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.floor(x);
}

/**
 * @param {unknown} allowedModels
 * @param {string} modelName
 * @returns {boolean}
 */
function isModelAllowed(allowedModels, modelName) {
  const m = String(modelName ?? "").trim();
  if (!m) return false;
  if (allowedModels === "*") return true;
  const models = Array.isArray(allowedModels) ? allowedModels : [];
  if (models.includes("*")) return true;
  return models.some((x) => String(x).trim() === m);
}

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @returns {Promise<import('@prisma/client').Plan>}
 */
async function ensureFreePlan(tx) {
  const existing = await tx.plan.findFirst({
    where: { slug: "free", deletedAt: null },
  });
  if (existing) return existing;
  try {
    return await tx.plan.create({
      data: {
        slug: "free",
        name: "Free (autocreated)",
        maxRequestsPerMonth: 100,
        maxTokensPerMonth: 50_000,
        allowedModels: ["*"],
      },
    });
  } catch (err) {
    if (err && err.code === "P2002") {
      const again = await tx.plan.findFirst({
        where: { slug: "free", deletedAt: null },
      });
      if (again) return again;
    }
    throw err;
  }
}

/**
 * Lock org row, optionally reset period, enforce limits, increment counters, append usage log — one transaction.
 * @param {object} params
 * @param {string} params.organizationId
 * @param {string|null|undefined} params.userId
 * @param {string|null|undefined} params.apiKeyId
 * @param {string|null|undefined} params.assistantId
 * @param {string|null|undefined} params.conversationId
 * @param {string} params.model
 * @param {unknown} params.inputTokens
 * @param {unknown} params.outputTokens
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
async function finalizeChatUsage(params) {
  const {
    organizationId,
    userId,
    apiKeyId,
    assistantId,
    conversationId,
    model,
    inputTokens,
    outputTokens,
  } = params;

  const inT = safeTokenCount(inputTokens);
  const outT = safeTokenCount(outputTokens);
  const total = inT + outT;
  const modelName = String(model ?? "").trim();

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`
      SELECT
        o.id AS org_id,
        o.requests_used,
        o.tokens_used,
        o.reset_at,
        o.is_blocked,
        p.max_requests_per_month,
        p.max_tokens_per_month,
        p.allowed_models
      FROM organizations o
      INNER JOIN plans p ON p.id = o.plan_id
      WHERE o.id = ${organizationId}::uuid
      FOR UPDATE OF o
    `;

    const row = Array.isArray(locked) && locked[0] ? locked[0] : null;
    if (!row) {
      return { ok: false, status: 404, error: "Organization not found" };
    }

    const now = new Date();
    let requestsUsed = safeTokenCount(row.requests_used);
    let tokensUsed = safeTokenCount(row.tokens_used);
    const resetAt = row.reset_at;

    if (resetAt != null && now > resetAt) {
      const nextReset = startOfNextCalendarMonthUTC(now);
      const applied = await tx.$queryRaw`
        UPDATE organizations o
        SET requests_used = 0, tokens_used = 0, reset_at = ${nextReset}
        WHERE o.id = ${organizationId}::uuid
          AND o.reset_at IS NOT NULL
          AND o.reset_at < ${now}
        RETURNING o.requests_used, o.tokens_used
      `;
      if (Array.isArray(applied) && applied[0]) {
        requestsUsed = safeTokenCount(applied[0].requests_used);
        tokensUsed = safeTokenCount(applied[0].tokens_used);
      } else {
        const snap = await tx.$queryRaw`
          SELECT o.requests_used, o.tokens_used
          FROM organizations o
          WHERE o.id = ${organizationId}::uuid
        `;
        const s = Array.isArray(snap) && snap[0] ? snap[0] : null;
        if (s) {
          requestsUsed = safeTokenCount(s.requests_used);
          tokensUsed = safeTokenCount(s.tokens_used);
        }
      }
    }

    if (row.is_blocked === true) {
      return { ok: false, status: 403, error: "Organization is blocked" };
    }

    const allowedModels = row.allowed_models;
    if (!isModelAllowed(allowedModels, modelName)) {
      return { ok: false, status: 403, error: "Model not allowed for your plan" };
    }

    const maxReq = row.max_requests_per_month;
    const maxTok = row.max_tokens_per_month;
    const maxReqN = maxReq != null ? safeTokenCount(maxReq) : null;
    const maxTokN = maxTok != null ? safeTokenCount(maxTok) : null;

    if (maxReqN != null && requestsUsed >= maxReqN) {
      return { ok: false, status: 403, error: "Monthly request limit exceeded" };
    }

    if (maxTokN != null && tokensUsed + total > maxTokN) {
      return { ok: false, status: 403, error: "Monthly token limit exceeded" };
    }

    await tx.organization.update({
      where: { id: organizationId },
      data: {
        requestsUsed: { increment: 1 },
        tokensUsed: { increment: total },
      },
    });

    await tx.usage.create({
      data: {
        organizationId,
        userId: userId || null,
        apiKeyId: apiKeyId || null,
        assistantId: assistantId || null,
        conversationId: conversationId || null,
        model: modelName,
        tokens: total,
      },
    });

    return { ok: true };
  });
}

/**
 * Проверка плана и лимитов ДО вызова LLM (402/403). Логика согласована с finalizeChatUsage
 * (сброс периода по reset_at применяется так же в read-only виде).
 *
 * @param {object} params
 * @param {string} params.organizationId
 * @param {string} params.modelName
 * @param {unknown} params.estimatedInputTokens
 * @param {unknown} params.estimatedOutputTokens
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
async function preCheckChatBeforeLlm(params) {
  const { organizationId, modelName, estimatedInputTokens, estimatedOutputTokens } = params;

  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    include: { plan: true },
  });
  if (!org || !org.plan) {
    return { ok: false, status: 404, error: "Organization not found" };
  }
  if (org.isBlocked === true) {
    return { ok: false, status: 403, error: "Organization is blocked" };
  }

  let requestsUsed = safeTokenCount(org.requestsUsed);
  let tokensUsed = safeTokenCount(org.tokensUsed);
  const now = new Date();
  if (org.resetAt != null && now > org.resetAt) {
    requestsUsed = 0;
    tokensUsed = 0;
  }

  const allowedModels = org.plan.allowedModels;
  const m = String(modelName ?? "").trim();
  if (!isModelAllowed(allowedModels, m)) {
    return { ok: false, status: 403, error: "Model not allowed for your plan" };
  }

  const inT = safeTokenCount(estimatedInputTokens);
  const outT = safeTokenCount(estimatedOutputTokens);
  const total = inT + outT;

  const maxReq = org.plan.maxRequestsPerMonth;
  const maxTok = org.plan.maxTokensPerMonth;
  const maxReqN = maxReq != null ? safeTokenCount(maxReq) : null;
  const maxTokN = maxTok != null ? safeTokenCount(maxTok) : null;

  if (maxReqN != null && requestsUsed >= maxReqN) {
    return { ok: false, status: 402, error: "Monthly request limit exceeded" };
  }
  if (maxTokN != null && tokensUsed + total > maxTokN) {
    return { ok: false, status: 402, error: "Monthly token limit exceeded" };
  }

  return { ok: true };
}

module.exports = {
  finalizeChatUsage,
  preCheckChatBeforeLlm,
  ensureFreePlan,
  getInitialResetAt,
  startOfNextCalendarMonthUTC,
  safeTokenCount,
  isModelAllowed,
};
