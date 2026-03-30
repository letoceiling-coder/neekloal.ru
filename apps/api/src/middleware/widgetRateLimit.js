"use strict";

const { incrementAndCheck } = require("../services/rateLimitStore");
const { isWidgetClientRequest } = require("../services/widgetSales");

const WIDGET_IP_LIMIT = 60;
const WIDGET_IP_WINDOW_MS = 60 * 60 * 1000;

const WIDGET_CONV_LIMIT = 90;
const WIDGET_CONV_WINDOW_MS = 60 * 1000;

const WIDGET_CHAT_IP_LIMIT = 120;
const WIDGET_CHAT_IP_WINDOW_MS = 60 * 1000;

/**
 * Лимит создания бесед виджета по IP + org.
 */
async function widgetIpRateLimit(request, reply) {
  if (request.organizationId == null) {
    return;
  }
  const ip = request.ip || request.socket?.remoteAddress || "unknown";
  const key = `widget_ip:${request.organizationId}:${ip}`;
  const result = await incrementAndCheck(key, WIDGET_IP_LIMIT, WIDGET_IP_WINDOW_MS);
  if (result.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
}

/**
 * Лимит POST /chat для виджета: по conversationId и по IP.
 */
async function widgetChatRateLimit(request, reply) {
  if (!isWidgetClientRequest(request) || request.organizationId == null) {
    return;
  }
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const convId =
    body.conversationId != null && String(body.conversationId).trim() !== ""
      ? String(body.conversationId).trim()
      : null;
  if (!convId) {
    return;
  }

  const convKey = `widget_conv:${convId}`;
  const r1 = await incrementAndCheck(convKey, WIDGET_CONV_LIMIT, WIDGET_CONV_WINDOW_MS);
  if (r1.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }

  const ip = request.ip || request.socket?.remoteAddress || "unknown";
  const ipKey = `widget_chat_ip:${request.organizationId}:${ip}`;
  const r2 = await incrementAndCheck(ipKey, WIDGET_CHAT_IP_LIMIT, WIDGET_CHAT_IP_WINDOW_MS);
  if (r2.exceeded) {
    return reply.code(429).send({ error: "Too Many Requests" });
  }
}

module.exports = {
  widgetIpRateLimit,
  widgetChatRateLimit,
};
