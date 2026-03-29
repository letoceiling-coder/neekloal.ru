"use strict";

const prisma = require("../lib/prisma");
const requireRoot = require("../middleware/requireRoot");
const adminRateLimitMiddleware = require("../middleware/adminRateLimit");
const { appendAdminAudit } = require("../services/adminAudit");

const preRoot = [requireRoot, adminRateLimitMiddleware];

const ALLOWED_USER_ROLES = ["user", "admin", "root"];

/** @param {unknown} v */
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Plan allowedModels: literal "*" or non-empty string array.
 * @param {unknown} v
 * @returns {{ ok: true, value: import('@prisma/client').Prisma.InputJsonValue } | { ok: false, error: string }}
 */
function validateAllowedModelsInput(v) {
  if (v === "*") {
    return { ok: true, value: "*" };
  }
  if (typeof v === "string" && v.trim() === "*") {
    return { ok: true, value: "*" };
  }
  if (!Array.isArray(v)) {
    return { ok: false, error: "allowedModels must be \"*\" or a string array" };
  }
  const out = [];
  for (const x of v) {
    if (typeof x !== "string" || String(x).trim() === "") {
      return { ok: false, error: "allowedModels array must contain non-empty strings" };
    }
    out.push(String(x).trim());
  }
  return { ok: true, value: out };
}

/** @param {object} org */
function orgSnapshot(org) {
  return {
    name: org.name,
    planId: org.planId,
    isBlocked: org.isBlocked,
    requestsUsed: org.requestsUsed,
    tokensUsed: org.tokensUsed,
    resetAt: org.resetAt instanceof Date ? org.resetAt.toISOString() : org.resetAt,
  };
}

/** @param {object} plan */
function planSnapshot(plan) {
  return {
    name: plan.name,
    maxRequestsPerMonth: plan.maxRequestsPerMonth,
    maxTokensPerMonth: plan.maxTokensPerMonth,
    allowedModels: plan.allowedModels,
  };
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function adminRoutes(fastify) {
  fastify.get("/organizations", { preHandler: preRoot }, async () => {
    return prisma.organization.findMany({
      where: { deletedAt: null },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  });

  fastify.patch("/organizations/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const body = isPlainObject(request.body) ? request.body : {};
    /** @type {import('@prisma/client').Prisma.OrganizationUpdateInput} */
    const data = {};

    if (body.name != null) data.name = String(body.name).trim();
    if (body.planId != null) {
      const planId = String(body.planId).trim();
      const plan = await prisma.plan.findFirst({
        where: { id: planId, deletedAt: null },
      });
      if (!plan) {
        return reply.code(400).send({ error: "Plan not found" });
      }
      data.plan = { connect: { id: planId } };
    }
    if (body.isBlocked !== undefined) data.isBlocked = Boolean(body.isBlocked);
    if (body.requestsUsed != null) data.requestsUsed = Math.max(0, Math.floor(Number(body.requestsUsed)));
    if (body.tokensUsed != null) data.tokensUsed = Math.max(0, Math.floor(Number(body.tokensUsed)));
    if (body.resetAt != null) {
      const d = new Date(String(body.resetAt));
      if (Number.isNaN(d.getTime())) {
        return reply.code(400).send({ error: "Invalid resetAt" });
      }
      data.resetAt = d;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existingOrg = await prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existingOrg) {
      return reply.code(404).send({ error: "Organization not found" });
    }

    const before = orgSnapshot(existingOrg);
    const dataKeys = Object.keys(data);
    const action =
      dataKeys.length === 1 && Object.prototype.hasOwnProperty.call(data, "isBlocked")
        ? "organization.block"
        : "organization.update";

    return prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id },
        data,
        include: { plan: true },
      });
      await appendAdminAudit(tx, {
        adminId,
        action,
        entity: "organization",
        entityId: id,
        payload: { before, after: orgSnapshot(org) },
      });
      return org;
    });
  });

  fastify.delete("/organizations/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const org = await prisma.organization.findFirst({
      where: { id, deletedAt: null },
    });
    if (!org) {
      return reply.code(404).send({ error: "Organization not found" });
    }
    const memberCount = await prisma.membership.count({
      where: { organizationId: id, deletedAt: null },
    });
    if (memberCount > 0) {
      return reply
        .code(409)
        .send({ error: "Cannot delete organization with active members" });
    }
    const before = orgSnapshot(org);
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await appendAdminAudit(tx, {
        adminId,
        action: "organization.delete",
        entity: "organization",
        entityId: id,
        payload: { before, soft: true },
      });
    });
    return reply.code(200).send({ ok: true });
  });

  fastify.get("/users", { preHandler: preRoot }, async () => {
    return prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  });

  fastify.patch("/users/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const body = isPlainObject(request.body) ? request.body : {};
    /** @type {import('@prisma/client').Prisma.UserUpdateInput} */
    const data = {};

    if (body.email != null) {
      const email = String(body.email).trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return reply.code(400).send({ error: "Valid email is required" });
      }
      data.email = email;
    }
    if (body.role != null) {
      const r = String(body.role).trim();
      if (!ALLOWED_USER_ROLES.includes(r)) {
        return reply.code(400).send({ error: "Invalid role" });
      }
      data.role = r;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existingUser = await prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existingUser) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (existingUser.role === "root" && body.role != null) {
      const nextRole = String(body.role).trim();
      if (nextRole !== "root") {
        return reply.code(403).send({ error: "Cannot demote root user" });
      }
    }

    const before = { email: existingUser.email, role: existingUser.role };

    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id },
          data,
          select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        await appendAdminAudit(tx, {
          adminId,
          action: "user.update",
          entity: "user",
          entityId: id,
          payload: {
            before,
            after: { email: user.email, role: user.role },
          },
        });
        return user;
      });
    } catch (err) {
      if (err && err.code === "P2002") {
        return reply.code(409).send({ error: "Email already in use" });
      }
      throw err;
    }
  });

  fastify.delete("/users/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    if (id === adminId) {
      return reply.code(403).send({ error: "Cannot delete your own account" });
    }
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }
    if (user.role === "root") {
      return reply.code(403).send({ error: "Cannot delete root user" });
    }
    const before = { email: user.email, role: user.role };
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await appendAdminAudit(tx, {
        adminId,
        action: "user.delete",
        entity: "user",
        entityId: id,
        payload: { before, soft: true },
      });
    });
    return reply.code(200).send({ ok: true });
  });

  fastify.get("/plans", { preHandler: preRoot }, async () => {
    return prisma.plan.findMany({
      where: { deletedAt: null },
      orderBy: { slug: "asc" },
    });
  });

  /**
   * @param {string} raw
   * @returns {{ ok: true, value: string } | { ok: false, error: string }}
   */
  function validatePlanSlug(raw) {
    const s = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (!s || s.length > 64) {
      return { ok: false, error: "Invalid slug" };
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
      return {
        ok: false,
        error: "Slug must be lowercase letters, digits and single hyphens",
      };
    }
    return { ok: true, value: s };
  }

  fastify.post("/plans", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const body = isPlainObject(request.body) ? request.body : {};
    const slugRes = validatePlanSlug(body.slug);
    if (!slugRes.ok) {
      return reply.code(400).send({ error: slugRes.error });
    }
    const name = String(body.name ?? "").trim();
    if (!name) {
      return reply.code(400).send({ error: "name is required" });
    }
    const vm = validateAllowedModelsInput(body.allowedModels);
    if (!vm.ok) {
      return reply.code(400).send({ error: vm.error });
    }
    if (Array.isArray(vm.value) && vm.value.length === 0) {
      return reply
        .code(400)
        .send({
          error: 'allowedModels must be "*" or a non-empty string array',
        });
    }
    let maxRequestsPerMonth = null;
    if (body.maxRequestsPerMonth !== undefined && body.maxRequestsPerMonth !== null) {
      const n = Math.floor(Number(body.maxRequestsPerMonth));
      if (!Number.isFinite(n) || n < 0) {
        return reply.code(400).send({ error: "Invalid maxRequestsPerMonth" });
      }
      maxRequestsPerMonth = n;
    }
    let maxTokensPerMonth = null;
    if (body.maxTokensPerMonth !== undefined && body.maxTokensPerMonth !== null) {
      const n = Math.floor(Number(body.maxTokensPerMonth));
      if (!Number.isFinite(n) || n < 0) {
        return reply.code(400).send({ error: "Invalid maxTokensPerMonth" });
      }
      maxTokensPerMonth = n;
    }
    const dup = await prisma.plan.findFirst({
      where: { slug: slugRes.value, deletedAt: null },
    });
    if (dup) {
      return reply.code(409).send({ error: "Plan slug already exists" });
    }
    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.plan.create({
          data: {
            slug: slugRes.value,
            name,
            maxRequestsPerMonth,
            maxTokensPerMonth,
            allowedModels: vm.value,
          },
        });
        await appendAdminAudit(tx, {
          adminId,
          action: "plan.create",
          entity: "plan",
          entityId: plan.id,
          payload: { after: planSnapshot(plan) },
        });
        return plan;
      });
    } catch (err) {
      if (err && err.code === "P2002") {
        return reply.code(409).send({ error: "Plan slug already exists" });
      }
      throw err;
    }
  });

  fastify.patch("/plans/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const body = isPlainObject(request.body) ? request.body : {};
    /** @type {import('@prisma/client').Prisma.PlanUpdateInput} */
    const data = {};

    if (body.name != null) data.name = String(body.name).trim();
    if (body.maxRequestsPerMonth !== undefined) {
      if (body.maxRequestsPerMonth === null) {
        data.maxRequestsPerMonth = null;
      } else {
        const n = Math.floor(Number(body.maxRequestsPerMonth));
        if (!Number.isFinite(n) || n < 0) {
          return reply.code(400).send({ error: "Invalid maxRequestsPerMonth" });
        }
        data.maxRequestsPerMonth = n;
      }
    }
    if (body.maxTokensPerMonth !== undefined) {
      if (body.maxTokensPerMonth === null) {
        data.maxTokensPerMonth = null;
      } else {
        const n = Math.floor(Number(body.maxTokensPerMonth));
        if (!Number.isFinite(n) || n < 0) {
          return reply.code(400).send({ error: "Invalid maxTokensPerMonth" });
        }
        data.maxTokensPerMonth = n;
      }
    }
    if (body.allowedModels != null) {
      const vm = validateAllowedModelsInput(body.allowedModels);
      if (!vm.ok) {
        return reply.code(400).send({ error: vm.error });
      }
      data.allowedModels = vm.value;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existingPlan = await prisma.plan.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existingPlan) {
      return reply.code(404).send({ error: "Plan not found" });
    }

    const before = planSnapshot(existingPlan);

    try {
      return await prisma.$transaction(async (tx) => {
        const plan = await tx.plan.update({
          where: { id },
          data,
        });
        await appendAdminAudit(tx, {
          adminId,
          action: "plan.update",
          entity: "plan",
          entityId: id,
          payload: { before, after: planSnapshot(plan) },
        });
        return plan;
      });
    } catch {
      return reply.code(404).send({ error: "Plan not found" });
    }
  });

  fastify.delete("/plans/:id", { preHandler: preRoot }, async (request, reply) => {
    const adminId = request.userId;
    if (!adminId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const plan = await prisma.plan.findFirst({
      where: { id, deletedAt: null },
    });
    if (!plan) {
      return reply.code(404).send({ error: "Plan not found" });
    }
    const orgCount = await prisma.organization.count({
      where: { planId: id, deletedAt: null },
    });
    if (orgCount > 0) {
      return reply
        .code(409)
        .send({
          error:
            "Cannot delete plan: reassign or remove organizations using this plan first",
        });
    }
    const before = planSnapshot(plan);
    await prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await appendAdminAudit(tx, {
        adminId,
        action: "plan.delete",
        entity: "plan",
        entityId: id,
        payload: { before, soft: true },
      });
    });
    return reply.code(200).send({ ok: true });
  });

  fastify.get("/usage", { preHandler: preRoot }, async (request) => {
    const q = request.query && typeof request.query === "object" ? request.query : {};
    const limitRaw = q.limit != null ? Number(q.limit) : 100;
    const offsetRaw = q.offset != null ? Number(q.offset) : 0;
    const limit = Math.min(500, Math.max(1, Math.floor(Number.isFinite(limitRaw) ? limitRaw : 100)));
    const offset = Math.max(0, Math.floor(Number.isFinite(offsetRaw) ? offsetRaw : 0));

    /** @type {import('@prisma/client').Prisma.UsageWhereInput} */
    const where = {};
    const orgFilter = q.organizationId != null ? String(q.organizationId).trim() : "";
    if (orgFilter) {
      where.organizationId = orgFilter;
    }
    const modelFilter = q.model != null ? String(q.model).trim() : "";
    if (modelFilter) {
      where.model = modelFilter;
    }

    const [items, total] = await Promise.all([
      prisma.usage.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          organization: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, email: true } },
        },
      }),
      prisma.usage.count({ where }),
    ]);

    return { items, total, limit, offset };
  });

  fastify.get("/leads", { preHandler: preRoot }, async () => {
    return prisma.lead.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 400,
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        conversations: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, source: true, createdAt: true },
        },
      },
    });
  });

  fastify.get("/leads/:id", { preHandler: preRoot }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const lead = await prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        conversations: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: "asc" },
              take: 500,
              select: { id: true, role: true, content: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!lead) {
      return reply.code(404).send({ error: "Lead not found" });
    }
    return lead;
  });
};
