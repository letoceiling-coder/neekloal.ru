"use strict";

const prisma = require("../lib/prisma");
const authMiddleware = require("../middleware/auth");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function assistantsRoutes(fastify) {
  fastify.get("/assistants", { preHandler: authMiddleware }, async (request) => {
    return prisma.assistant.findMany({
      where: { organizationId: request.organizationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
  });

  fastify.post("/assistants", { preHandler: authMiddleware }, async (request, reply) => {
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const { name, model, systemPrompt } = body;

    if (name == null || String(name).trim() === "") {
      return reply.code(400).send({ error: "name is required" });
    }
    if (model == null || String(model).trim() === "") {
      return reply.code(400).send({ error: "model is required" });
    }
    if (systemPrompt == null) {
      return reply.code(400).send({ error: "systemPrompt is required" });
    }

    const assistant = await prisma.assistant.create({
      data: {
        organizationId: request.organizationId,
        name: String(name),
        model: String(model),
        systemPrompt: String(systemPrompt),
      },
    });
    return reply.code(201).send(assistant);
  });

  fastify.patch("/assistants/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }
    const body = request.body && typeof request.body === "object" ? request.body : {};
    /** @type {import('@prisma/client').Prisma.AssistantUpdateInput} */
    const data = {};

    if (body.name != null) data.name = String(body.name).trim();
    if (body.model != null) data.model = String(body.model).trim();
    if (body.systemPrompt != null) data.systemPrompt = String(body.systemPrompt);
    if (body.settings !== undefined) {
      data.settings = body.settings;
    }
    if (body.config !== undefined) {
      // null clears the config override; object sets it
      data.config = body.config !== null && typeof body.config === "object" ? body.config : null;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "No valid fields to update" });
    }

    const existing = await prisma.assistant.findFirst({
      where: {
        id,
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    const updated = await prisma.assistant.update({
      where: { id },
      data,
    });
    return updated;
  });

  fastify.delete("/assistants/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = String(request.params.id || "").trim();
    if (!id) {
      return reply.code(400).send({ error: "id is required" });
    }

    const existing = await prisma.assistant.findFirst({
      where: {
        id,
        organizationId: request.organizationId,
        deletedAt: null,
      },
    });
    if (!existing) {
      return reply.code(404).send({ error: "Assistant not found" });
    }

    await prisma.assistant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return reply.code(200).send({ ok: true });
  });
};
