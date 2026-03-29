"use strict";

const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");
const authMiddleware = require("../middleware/auth");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function apiKeysRoutes(fastify) {
  fastify.get("/api-keys", { preHandler: authMiddleware }, async (request) => {
    const rows = await prisma.apiKey.findMany({
      where: { organizationId: request.organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        assistantId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows;
  });

  fastify.post("/api-keys", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const name = body.name != null ? String(body.name).trim() : null;
    const rawAssistantId =
      body.assistantId != null ? String(body.assistantId).trim() : null;

    let assistantId = null;
    if (rawAssistantId) {
      const asst = await prisma.assistant.findFirst({
        where: {
          id: rawAssistantId,
          organizationId: request.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!asst) {
        return reply.code(400).send({ error: "Assistant not found in your organization" });
      }
      assistantId = asst.id;
    }

    const key = `sk-${crypto.randomBytes(16).toString("hex")}`;
    const keyHash = hashApiKey(key);

    const row = await prisma.apiKey.create({
      data: {
        organizationId: request.organizationId,
        keyHash,
        name: name && name !== "" ? name : null,
        assistantId,
      },
    });

    return reply.code(201).send({
      id: row.id,
      key,
      assistantId: row.assistantId,
      organizationId: request.organizationId,
    });
  });

  fastify.delete("/api-keys/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const row = await prisma.apiKey.findFirst({
      where: { id, organizationId: request.organizationId, deletedAt: null },
    });
    if (!row) {
      return reply.code(404).send({ error: "API key not found" });
    }
    await prisma.apiKey.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return reply.code(204).send();
  });
};
