"use strict";

const { listAvailableModels } = require("../services/modelRouter");

/**
 * GET /models — единый каталог моделей для UI (планы, usage, ассистенты).
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function modelsRoutes(fastify) {
  fastify.get("/models", async () => {
    const models = await listAvailableModels();
    return { models };
  });
};
