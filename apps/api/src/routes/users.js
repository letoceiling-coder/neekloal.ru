"use strict";

const crypto = require("crypto");
const { append } = require("../services/usersStore");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function usersRoutes(fastify) {
  fastify.post("/users", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const email = body.email;

    if (email == null || String(email).trim() === "") {
      return reply.code(400).send({ error: "email is required" });
    }

    const user = {
      id: crypto.randomUUID(),
      email: String(email).trim(),
    };

    append(user);
    return reply.code(201).send(user);
  });
};
