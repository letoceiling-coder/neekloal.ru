"use strict";

const prisma = require("../lib/prisma");
const chatAuthMiddleware = require("../middleware/chatAuth");
const rateLimitMiddleware = require("../middleware/rateLimit");
const { widgetIpRateLimit } = require("../middleware/widgetRateLimit");
const { assertWidgetDomainAllowed } = require("../services/widgetSales");
const { getLeadPhoneDigitsFromText } = require("../services/leadCapture");
const { notifyNewLead } = require("../services/leadNotifications");

const FIRST_MSG_MAX = 8000;

/**
 * Виджет: лид + беседа (CRM). Visitor-метаданные + проверка домена + лимит по IP.
 * Домены: assistant.settings.widgetAllowedDomains = ["example.com","*.cdn.example.com"]
 * @param {import('fastify').FastifyInstance} fastify
 */
module.exports = async function widgetRoutes(fastify) {
  fastify.post(
    "/widget/conversation",
    { preHandler: [chatAuthMiddleware, rateLimitMiddleware, widgetIpRateLimit] },
    async (request, reply) => {
      if (request.userId == null) {
        return reply.code(403).send({ error: "No acting user for this organization" });
      }

      const body = request.body && typeof request.body === "object" ? request.body : {};
      const assistantId = body.assistantId != null ? String(body.assistantId).trim() : "";
      if (!assistantId) {
        return reply.code(400).send({ error: "assistantId is required" });
      }

      const assistant = await prisma.assistant.findFirst({
        where: {
          id: assistantId,
          organizationId: request.organizationId,
          deletedAt: null,
        },
      });
      if (!assistant) {
        return reply.code(404).send({ error: "Assistant not found" });
      }

      const domainCheck = assertWidgetDomainAllowed(assistant, request);
      if (!domainCheck.ok) {
        return reply.code(403).send({ error: domainCheck.error });
      }

      const userAgent =
        body.userAgent != null ? String(body.userAgent).slice(0, 4000) : null;
      const refererRaw = body.referer != null ? body.referer : body.referrer;
      const referer = refererRaw != null ? String(refererRaw).slice(0, 4000) : null;
      const firstMessageRaw =
        body.firstMessage != null && String(body.firstMessage).trim() !== ""
          ? String(body.firstMessage).trim().slice(0, FIRST_MSG_MAX)
          : null;

      const phoneDigits =
        firstMessageRaw != null ? getLeadPhoneDigitsFromText(firstMessageRaw) : null;

      let lead = null;
      if (phoneDigits) {
        const existing = await prisma.lead.findFirst({
          where: {
            organizationId: request.organizationId,
            deletedAt: null,
            OR: [{ phone: phoneDigits }, { phone: `+${phoneDigits}` }],
          },
        });
        if (existing) {
          lead = existing;
          await prisma.lead.update({
            where: { id: lead.id },
            data: {
              ...(firstMessageRaw &&
              (lead.firstMessage == null || String(lead.firstMessage).trim() === "")
                ? { firstMessage: firstMessageRaw }
                : {}),
              ...(userAgent != null ? { userAgent } : {}),
              ...(referer != null ? { referer } : {}),
            },
          });
        }
      }

      if (!lead) {
        lead = await prisma.lead.create({
          data: {
            organizationId: request.organizationId,
            name: "Widget visitor",
            source: "widget",
            status: "NEW",
            userAgent,
            referer,
            firstMessage: firstMessageRaw,
            ...(phoneDigits ? { phone: phoneDigits } : {}),
          },
        });
        createdNewLead = true;
      }

      if (createdNewLead) {
        void (async () => {
          try {
            const org = await prisma.organization.findFirst({
              where: { id: request.organizationId, deletedAt: null },
              select: { name: true },
            });
            await notifyNewLead(
              {
                lead,
                organizationName: org?.name ?? null,
              },
              fastify.log
            );
          } catch (err) {
            fastify.log.warn({ err }, "lead notify failed");
          }
        })();
      }

      const conversation = await prisma.conversation.create({
        data: {
          organizationId: request.organizationId,
          assistantId: assistant.id,
          leadId: lead.id,
          status: "OPEN",
          source: "WIDGET",
          createdByUserId: request.userId,
        },
      });

      return reply.code(201).send({
        conversationId: conversation.id,
        leadId: lead.id,
      });
    },
  );

  fastify.get(
    "/widget/messages",
    { preHandler: [chatAuthMiddleware, rateLimitMiddleware, widgetIpRateLimit] },
    async (request, reply) => {
      if (request.userId == null) {
        return reply.code(403).send({ error: "No acting user for this organization" });
      }

      const q = request.query && typeof request.query === "object" ? request.query : {};
      const conversationId =
        q.conversationId != null ? String(q.conversationId).trim() : "";
      const afterRaw = q.after != null ? String(q.after).trim() : "";
      if (!conversationId) {
        return reply.code(400).send({ error: "conversationId is required" });
      }

      const conv = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          organizationId: request.organizationId,
          deletedAt: null,
          source: "WIDGET",
        },
      });
      if (!conv) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const afterDate = afterRaw ? new Date(afterRaw) : new Date(0);
      if (Number.isNaN(afterDate.getTime())) {
        return reply.code(400).send({ error: "Invalid after" });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          organizationId: request.organizationId,
          deletedAt: null,
          createdAt: { gt: afterDate },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: { id: true, role: true, content: true, createdAt: true },
      });

      return { messages };
    },
  );
};
