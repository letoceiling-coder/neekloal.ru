"use strict";

const { listAvailableModels } = require("../services/modelRouter");

/**
 * GET /models — catalog of available Ollama models.
 * Returns { models: [{ name, size?, modified_at? }] }
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function modelsRoutes(fastify) {
  fastify.get("/models", async () => {
    const raw = await listAvailableModels(); // string[] or {name,...}[]
    const models = raw.map((m) =>
      typeof m === "string" ? { name: m } : { name: m.name, size: m.size, modified_at: m.modified_at }
    );
    return { models };
  });
};
