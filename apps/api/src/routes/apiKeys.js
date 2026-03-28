"use strict";

const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function apiKeysRoutes(fastify) {
  fastify.post("/api-keys", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const userId = body.userId;

    if (userId == null || String(userId).trim() === "") {
      return reply.code(400).send({ error: "userId is required" });
    }

    const uid = String(userId);
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) {
      return reply.code(400).send({ error: "user not found" });
    }

    const key = `sk-${crypto.randomBytes(16).toString("hex")}`;
    const keyHash = hashApiKey(key);

    await prisma.apiKey.create({
      data: { keyHash, userId: uid },
    });

    return reply.code(201).send({ key, userId: uid });
  });
};
