"use strict";

/**
 * conversationTakeover.js — "take to work" / "release to AI" for AgentConversation.
 *
 * Endpoints (JWT-auth; any org member can act on their org's conversations):
 *   POST /conversations/:id/takeover   body: { note?: string }
 *   POST /conversations/:id/release
 *   GET  /conversations/:id/takeover   — current state
 */

const authMiddleware = require("../middleware/auth");
const prisma = require("../lib/prisma");
const {
  takeOverConversation,
  releaseConversation,
} = require("../services/conversationTakeover");

function serialize(row, userMap) {
  if (!row) return null;
  const atIso = row.humanTakeoverAt instanceof Date
    ? row.humanTakeoverAt.toISOString()
    : row.humanTakeoverAt;
  return {
    id:           row.id,
    agentId:      row.agentId,
    source:       row.source,
    externalId:   row.externalId,
    humanTakeover: row.humanTakeoverAt
      ? {
          at:   atIso,
          by:   userMap && row.humanTakeoverBy
            ? { id: userMap.id, email: userMap.email }
            : (row.humanTakeoverBy ? { id: row.humanTakeoverBy, email: null } : null),
          note: row.humanTakeoverNote,
        }
      : null,
  };
}

/** @param {import('fastify').FastifyInstance} fastify */
module.exports = async function conversationTakeoverRoutes(fastify) {
  fastify.get(
    "/conversations/:id/takeover",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      const row = await prisma.agentConversation.findFirst({
        where:  { id, organizationId: request.organizationId },
        include: { humanTakeoverByUser: { select: { id: true, email: true } } },
      });
      if (!row) return reply.code(404).send({ error: "conversation not found" });

      return serialize(row, row.humanTakeoverByUser);
    }
  );

  fastify.post(
    "/conversations/:id/takeover",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const note = typeof body.note === "string" ? body.note : undefined;

      try {
        const updated = await takeOverConversation({
          conversationId: id,
          organizationId: request.organizationId,
          userId:         request.userId,
          note,
        });
        const withUser = await prisma.agentConversation.findUnique({
          where:  { id: updated.id },
          include: { humanTakeoverByUser: { select: { id: true, email: true } } },
        });
        return serialize(withUser, withUser?.humanTakeoverByUser ?? null);
      } catch (err) {
        const status = err && err.status ? err.status : 500;
        return reply.code(status).send({ error: err.message || "takeover failed" });
      }
    }
  );

  fastify.post(
    "/conversations/:id/release",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id ?? "").trim();
      if (!id) return reply.code(400).send({ error: "id is required" });

      try {
        const updated = await releaseConversation({
          conversationId: id,
          organizationId: request.organizationId,
        });
        return serialize(updated, null);
      } catch (err) {
        const status = err && err.status ? err.status : 500;
        return reply.code(status).send({ error: err.message || "release failed" });
      }
    }
  );
};
