"use strict";

/**
 * Telegram module — routes only (no changes to /api/v1/chat).
 *
 * POST /telegram/connect     — JWT (dashboard user)
 * POST /telegram/disconnect  — JWT (dashboard user)
 * POST /telegram/webhook/:botId — Telegram
 */

const authMiddleware = require("../../middleware/auth");
const { postConnect, postDisconnect, postWebhook } = require("./telegram.controller");

module.exports = async function telegramRoutes(fastify) {
  fastify.post("/connect", { preHandler: [authMiddleware] }, postConnect);
  fastify.post("/disconnect", { preHandler: [authMiddleware] }, postDisconnect);
  fastify.post("/webhook/:botId", postWebhook);
};
