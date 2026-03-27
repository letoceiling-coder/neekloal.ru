"use strict";

const crypto = require("crypto");
const { append } = require("../services/apiKeysStore");
const { findById: findUserById } = require("../services/usersStore");

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
    if (!findUserById(uid)) {
      return reply.code(400).send({ error: "user not found" });
    }

    const key = `sk-${crypto.randomBytes(16).toString("hex")}`;
    append({ key, userId: uid });
    return reply.code(201).send({ key, userId: uid });
  });
};
