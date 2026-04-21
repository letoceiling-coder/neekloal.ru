"use strict";

const optionalAuthMiddleware = require("../middleware/optionalAuth");
const { listAvailableModels } = require("../services/modelRouter");
const { listCloudModelEntries } = require("../services/integrationCatalog");

/**
 * GET /models — Ollama models + (when Bearer JWT present) cloud models from org integrations.
 * Returns { models: [{ name, provider?, kind?, size?, modified_at? }] }
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function modelsRoutes(fastify) {
  fastify.get("/models", { preHandler: [optionalAuthMiddleware] }, async (request) => {
    const raw = await listAvailableModels(); // string[] or {name,...}[]
    const ollamaModels = raw.map((m) => {
      if (typeof m === "string") {
        return { name: m, provider: "ollama", kind: "chat" };
      }
      return {
        name:         m.name,
        size:         m.size,
        modified_at:  m.modified_at,
        provider:     "ollama",
        kind:         "chat",
      };
    });

    let merged = ollamaModels;
    if (request.organizationId) {
      try {
        const cloud = await listCloudModelEntries(String(request.organizationId));
        merged = ollamaModels.concat(cloud);
      } catch (err) {
        fastify.log.warn({ err }, "integration model catalog merge failed");
      }
    }

    return { models: merged };
  });
};
