"use strict";

const prisma = require("../lib/prisma");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function usersRoutes(fastify) {
  fastify.get("/users", async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return users;
  });

  fastify.post("/users", async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const email = body.email;

    if (email == null || String(email).trim() === "") {
      return reply.code(400).send({ error: "email is required" });
    }

    const user = await prisma.user.create({
      data: { email: String(email).trim() },
    });
    return reply.code(201).send(user);
  });
};
