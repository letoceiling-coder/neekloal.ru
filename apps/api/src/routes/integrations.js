"use strict";

/**
 * Organization-scoped AI provider API keys (OpenAI, Anthropic, Google Gemini, xAI, …).
 *
 * GET  /integrations              — list providers + masked key state (any member)
 * PUT  /integrations/:provider    — upsert apiKey / isEnabled (OWNER/ADMIN)
 */

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

const WRITE_ROLES = new Set(["OWNER", "ADMIN"]);

const ALLOWED_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "xai",
  "replicate",
  "elevenlabs",
]);

/** @param {string} userId @param {string} organizationId */
async function getUserRole(userId, organizationId) {
  const m = await prisma.membership.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { role: true },
  });
  return m ? String(m.role).toUpperCase() : null;
}

/** @param {string|null|undefined} secret */
function maskSecret(secret) {
  const s = secret && String(secret).trim();
  if (!s) return { set: false, hint: null };
  const tail = s.length <= 4 ? "****" : s.slice(-4);
  return { set: true, hint: `…${tail}` };
}

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function integrationsRoutes(fastify) {
  fastify.get("/integrations", { preHandler: [authMiddleware] }, async (request) => {
    const organizationId = String(request.organizationId);
    const rows = await prisma.organizationAiIntegration.findMany({
      where: { organizationId },
    });
    const byProv = Object.fromEntries(rows.map((r) => [r.provider, r]));

    const catalog = [...ALLOWED_PROVIDERS].map((provider) => {
      const row = byProv[provider];
      const m = maskSecret(row?.apiKey ?? null);
      return {
        provider,
        isEnabled: Boolean(row?.isEnabled),
        apiKeySet: m.set,
        apiKeyHint: m.hint,
        updatedAt: row?.updatedAt
          ? (row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt)
          : null,
      };
    });

    return { integrations: catalog };
  });

  fastify.put("/integrations/:provider", { preHandler: [authMiddleware] }, async (request, reply) => {
    const organizationId = String(request.organizationId);
    const role = await getUserRole(request.userId, organizationId);
    if (!role || !WRITE_ROLES.has(role)) {
      return reply.code(403).send({ error: "forbidden: OWNER or ADMIN required" });
    }

    const provider = String(request.params.provider ?? "").trim().toLowerCase();
    if (!ALLOWED_PROVIDERS.has(provider)) {
      return reply.code(400).send({ error: `unknown provider: ${provider}` });
    }

    const body = request.body && typeof request.body === "object" ? request.body : {};
    const existing = await prisma.organizationAiIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });

    let apiKey = existing ? existing.apiKey : null;
    if ("apiKey" in body) {
      const raw = body.apiKey;
      if (raw === null || raw === "") apiKey = null;
      else if (typeof raw === "string" && raw.trim()) apiKey = raw.trim();
    }

    const isEnabled =
      "isEnabled" in body
        ? Boolean(body.isEnabled)
        : (existing ? existing.isEnabled : false);

    const saved = await prisma.organizationAiIntegration.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: {
        organizationId,
        provider,
        apiKey,
        isEnabled,
      },
      update: {
        apiKey,
        isEnabled,
      },
    });

    const m = maskSecret(saved.apiKey);
    return {
      provider,
      isEnabled: saved.isEnabled,
      apiKeySet: m.set,
      apiKeyHint: m.hint,
    };
  });
};
