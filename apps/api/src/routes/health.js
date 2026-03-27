"use strict";

const { checkOllama } = require("../services/ollama");

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function healthRoutes(fastify) {
  fastify.get("/health", async () => {
    const ollama = await checkOllama();
    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
      ollama,
    };
  });
};
