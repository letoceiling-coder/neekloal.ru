"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * Диалоги организации (дашборд): список, сообщения, создание.
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function conversationsRoutes(fastify) {
  fastify.get("/conversations", { preHandler: authMiddleware }, async (request) => {
    const rows = await prisma.conversation.findMany({
      where: { organizationId: request.organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        assistantId: true,
        status: true,
        source: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      assistantId: r.assistantId,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    }));
  });

  fastify.post("/conversations", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";
    if (!assistantId) {
      return reply.code(400).send({ error: "assistantId is required" });
    }

    const assistant = await prisma.assistant.findFirst({
      where: {
        id: assistantId,
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!assistant) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const conv = await prisma.conversation.create({
      data: {
        organizationId: request.organizationId,
        assistantId,
        status: "OPEN",
        source: "DASHBOARD",
        createdByUserId: request.userId,
      },
    });

    return reply.code(201).send({
      id: conv.id,
      assistantId: conv.assistantId,
      createdAt: conv.createdAt instanceof Date ? conv.createdAt.toISOString() : String(conv.createdAt),
    });
  });

  fastify.get(
    "/conversations/:id/messages",
    { preHandler: authMiddleware },
    async (request, reply) => {
      const id = String(request.params.id || "").trim();
      if (!id) {
        return reply.code(400).send({ error: "id is required" });
      }

      const conv = await prisma.conversation.findFirst({
        where: {
          id,
          organizationId: request.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!conv) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: id,
          organizationId: request.organizationId,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: 500,
        select: { id: true, role: true, content: true, createdAt: true },
      });

      return messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
      }));
    }
  );
};
