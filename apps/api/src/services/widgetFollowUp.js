"use strict";

const prisma = require("../lib/prisma");

const SILENCE_MS = 5 * 60 * 1000;
const BATCH = 80;

/** @returns {number} */
function maxFollowUpsPerConversation() {
  const n = Number(process.env.WIDGET_MAX_FOLLOWUPS_PER_CONVERSATION);
  if (!Number.isFinite(n) || n < 0) {
    return 2;
  }
  return Math.min(20, Math.max(0, Math.floor(n)));
}

const FOLLOWUP_TEXT =
  "Вы ещё с нами? Если остались вопросы или хотите оставить заявку — напишите здесь или пришлите телефон, мы быстро свяжемся.";

/**
 * @param {unknown} message
 */
function estimateTokensFromMessage(message) {
  const text = message == null ? "" : String(message);
  return Math.round(text.length / 4);
}

/**
 * Виджет: последнее сообщение от ассистента и пользователь молчит ≥5 мин → follow-up.
 * Не более maxFollowUpsPerConversation() на один диалог до следующего сообщения пользователя.
 * @param {{ warn?: (o: object, m?: string) => void }} [log]
 */
async function runWidgetFollowUpSweep(log) {
  const maxFollow = maxFollowUpsPerConversation();
  if (maxFollow <= 0) {
    return;
  }

  const threshold = new Date(Date.now() - SILENCE_MS);
  const convs = await prisma.conversation.findMany({
    where: {
      source: "WIDGET",
      deletedAt: null,
      status: { in: ["OPEN", "ACTIVE"] },
      widgetFollowUpCount: { lt: maxFollow },
    },
    select: { id: true, organizationId: true },
    take: BATCH,
  });

  for (const c of convs) {
    const last = await prisma.message.findFirst({
      where: {
        conversationId: c.id,
        organizationId: c.organizationId,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { role: true, createdAt: true },
    });
    if (!last || last.role !== "assistant") {
      continue;
    }
    if (last.createdAt > threshold) {
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.message.findFirst({
          where: {
            conversationId: c.id,
            organizationId: c.organizationId,
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          select: { role: true, createdAt: true },
        });
        if (!fresh || fresh.role !== "assistant" || fresh.createdAt > threshold) {
          return;
        }
        const convRow = await tx.conversation.findFirst({
          where: {
            id: c.id,
            deletedAt: null,
            widgetFollowUpCount: { lt: maxFollow },
          },
          select: { widgetFollowUpCount: true },
        });
        if (!convRow) {
          return;
        }

        await tx.message.create({
          data: {
            organizationId: c.organizationId,
            conversationId: c.id,
            role: "assistant",
            content: FOLLOWUP_TEXT,
            tokens: estimateTokensFromMessage(FOLLOWUP_TEXT),
          },
        });
        await tx.conversation.update({
          where: { id: c.id },
          data: {
            widgetFollowUpCount: { increment: 1 },
            widgetSilenceFollowUpSentAt: new Date(),
            status: "ACTIVE",
          },
        });
      });
    } catch (err) {
      log?.warn?.({ err, conversationId: c.id }, "widget follow-up failed");
    }
  }
}

module.exports = {
  runWidgetFollowUpSweep,
  SILENCE_MS,
  FOLLOWUP_TEXT,
  maxFollowUpsPerConversation,
};
