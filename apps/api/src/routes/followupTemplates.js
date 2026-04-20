"use strict";

/**
 * followupTemplates.js — per-organization follow-up sequence management API.
 *
 * All endpoints require JWT auth via middleware/auth.
 * OWNER/ADMIN can change; MEMBER/VIEWER can only read.
 *
 * Endpoints:
 *   GET    /followup-templates          — list (effective, ordered by step)
 *   GET    /followup-templates/defaults — read-only: hard-coded defaults
 *   PUT    /followup-templates          — replace the whole sequence
 */

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");
const { getDefaultSequence } = require("../services/followupTemplates");

const WRITE_ROLES = new Set(["OWNER", "ADMIN"]);

const MAX_STEPS = 10;
const MIN_DELAY = 1;
const MAX_DELAY = 60 * 24 * 7; // 1 week
const MAX_TEXT_LEN = 2000;

async function getUserRole(userId, organizationId) {
  const m = await prisma.membership.findFirst({
    where:  { userId, organizationId, deletedAt: null },
    select: { role: true },
  });
  return m ? String(m.role).toUpperCase() : null;
}

function serialize(r) {
  return {
    id:           r.id,
    step:         r.step,
    delayMinutes: r.delayMinutes,
    text:         r.text,
    isActive:     r.isActive,
    updatedAt:    r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function followupTemplatesRoutes(fastify) {
  // ── GET defaults ────────────────────────────────────────────────────────
  fastify.get(
    "/followup-templates/defaults",
    { preHandler: authMiddleware },
    async () => ({
      items: getDefaultSequence(),
    })
  );

  // ── GET list ────────────────────────────────────────────────────────────
  fastify.get(
    "/followup-templates",
    { preHandler: authMiddleware },
    async (request) => {
      const rows = await prisma.organizationFollowUpTemplate.findMany({
        where:   { organizationId: request.organizationId },
        orderBy: { step: "asc" },
      });

      const usingDefaults = rows.length === 0;
      const items = usingDefaults
        ? getDefaultSequence().map((d, idx) => ({
            id:           null,
            step:         d.step,
            delayMinutes: d.delayMinutes,
            text:         d.text,
            isActive:     true,
            updatedAt:    null,
            _syntheticOrder: idx,
          }))
        : rows.map(serialize);

      return {
        usingDefaults,
        items,
      };
    }
  );

  // ── PUT — replace whole sequence ────────────────────────────────────────
  fastify.put(
    "/followup-templates",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const role = await getUserRole(request.userId, request.organizationId);
      if (!role || !WRITE_ROLES.has(role)) {
        return reply.code(403).send({ error: "forbidden: OWNER or ADMIN required" });
      }

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const rawItems = Array.isArray(body.items) ? body.items : null;
      if (!rawItems) {
        return reply.code(400).send({ error: "items[] is required" });
      }
      if (rawItems.length > MAX_STEPS) {
        return reply.code(400).send({ error: `too many steps (max ${MAX_STEPS})` });
      }

      /** @type {{step:number,delayMinutes:number,text:string,isActive:boolean}[]} */
      const normalized = [];
      const seenSteps = new Set();

      for (let i = 0; i < rawItems.length; i++) {
        const it = rawItems[i] ?? {};
        const step = Number(it.step);
        const delayMinutes = Number(it.delayMinutes);
        const text = typeof it.text === "string" ? it.text.trim() : "";
        const isActive = it.isActive === false ? false : true;

        if (!Number.isInteger(step) || step < 1 || step > MAX_STEPS) {
          return reply.code(400).send({ error: `items[${i}].step must be integer in [1..${MAX_STEPS}]` });
        }
        if (seenSteps.has(step)) {
          return reply.code(400).send({ error: `items[${i}].step=${step} duplicates another entry` });
        }
        seenSteps.add(step);

        if (!Number.isInteger(delayMinutes) || delayMinutes < MIN_DELAY || delayMinutes > MAX_DELAY) {
          return reply.code(400).send({
            error: `items[${i}].delayMinutes must be integer in [${MIN_DELAY}..${MAX_DELAY}]`,
          });
        }
        if (!text) {
          return reply.code(400).send({ error: `items[${i}].text is required` });
        }
        if (text.length > MAX_TEXT_LEN) {
          return reply.code(400).send({ error: `items[${i}].text too long (max ${MAX_TEXT_LEN})` });
        }
        normalized.push({ step, delayMinutes, text, isActive });
      }

      // Sort by step so the effective sequence is deterministic on read-back.
      normalized.sort((a, b) => a.step - b.step);

      const saved = await prisma.$transaction(async (tx) => {
        await tx.organizationFollowUpTemplate.deleteMany({
          where: { organizationId: request.organizationId },
        });
        if (normalized.length === 0) return [];
        await tx.organizationFollowUpTemplate.createMany({
          data: normalized.map((n) => ({ ...n, organizationId: request.organizationId })),
        });
        return tx.organizationFollowUpTemplate.findMany({
          where:   { organizationId: request.organizationId },
          orderBy: { step: "asc" },
        });
      });

      return {
        usingDefaults: saved.length === 0,
        items: saved.map(serialize),
      };
    }
  );
};
