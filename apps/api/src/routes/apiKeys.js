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
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows;
  });

  fastify.post("/api-keys", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const name = body.name != null ? String(body.name).trim() : null;

    const key = `sk-${crypto.randomBytes(16).toString("hex")}`;
    const keyHash = hashApiKey(key);

    const row = await prisma.apiKey.create({
      data: {
        organizationId: request.organizationId,
        keyHash,
        name: name && name !== "" ? name : null,
      },
    });

    return reply.code(201).send({
      id: row.id,
      key,
      organizationId: request.organizationId,
    });
  });
};
