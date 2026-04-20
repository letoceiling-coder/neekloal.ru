"use strict";

/**
 * conversationTakeover.js — "take a conversation to work" / "release to AI".
 *
 * When a conversation has `humanTakeoverAt != null`, the AI pipeline must NOT
 * auto-reply to incoming messages on that conversation. A manager explicitly
 * resumes AI by calling `releaseConversation()`.
 *
 * On take-over we also cancel any pending follow-ups so the AI does not
 * spam the client while a human is handling the dialog.
 *
 * All functions are org-scoped: caller must supply `organizationId`, and we
 * verify the conversation belongs to the org before touching it.
 */

const prisma = require("../lib/prisma");
const { cancelFollowUps } = require("../modules/avito/avito.followup.queue");

/**
 * @typedef {{
 *   id: string,
 *   agentId: string,
 *   organizationId: string,
 *   source: string,
 *   externalId: string | null,
 *   humanTakeoverAt: Date | null,
 *   humanTakeoverBy: string | null,
 *   humanTakeoverNote: string | null,
 * }} ConvRow
 */

/**
 * Mark a conversation as "taken over by human".
 * Cancels pending follow-ups if this is an Avito conversation.
 *
 * @param {object} p
 * @param {string} p.conversationId
 * @param {string} p.organizationId
 * @param {string} p.userId
 * @param {string} [p.note]
 * @returns {Promise<ConvRow>}
 */
async function takeOverConversation(p) {
  const conv = await prisma.agentConversation.findFirst({
    where:  { id: p.conversationId, organizationId: p.organizationId },
  });
  if (!conv) {
    const err = new Error("conversation not found");
    /** @type {any} */ (err).status = 404;
    throw err;
  }

  const note = p.note && String(p.note).trim() ? String(p.note).trim().slice(0, 2000) : null;

  const updated = await prisma.agentConversation.update({
    where: { id: conv.id },
    data: {
      humanTakeoverAt:   new Date(),
      humanTakeoverBy:   p.userId,
      humanTakeoverNote: note,
    },
  });

  if (conv.source === "avito" && conv.externalId) {
    try {
      await cancelFollowUps({
        agentId: conv.agentId,
        chatId:  conv.externalId,
        reason:  "human_takeover",
      });
    } catch (err) {
      process.stderr.write(
        `[takeover] cancelFollowUps failed conv=${conv.id}: ${err && err.message ? err.message : String(err)}\n`
      );
    }
  }

  process.stdout.write(
    `[takeover] taken conv=${conv.id} by=${p.userId} source=${conv.source}\n`
  );

  return updated;
}

/**
 * Return a conversation back to AI autoreplies.
 *
 * @param {object} p
 * @param {string} p.conversationId
 * @param {string} p.organizationId
 * @returns {Promise<ConvRow>}
 */
async function releaseConversation(p) {
  const conv = await prisma.agentConversation.findFirst({
    where: { id: p.conversationId, organizationId: p.organizationId },
  });
  if (!conv) {
    const err = new Error("conversation not found");
    /** @type {any} */ (err).status = 404;
    throw err;
  }

  const updated = await prisma.agentConversation.update({
    where: { id: conv.id },
    data: {
      humanTakeoverAt:   null,
      humanTakeoverBy:   null,
      humanTakeoverNote: null,
    },
  });

  process.stdout.write(
    `[takeover] released conv=${conv.id} source=${conv.source}\n`
  );

  return updated;
}

/**
 * Boolean: is this conversation currently on "human takeover"?
 * Pass either a pre-loaded row (preferred, zero DB hits) or an id.
 *
 * @param {ConvRow | { humanTakeoverAt?: Date | null } | string} ref
 * @returns {Promise<boolean>}
 */
async function isConversationPaused(ref) {
  if (!ref) return false;
  if (typeof ref === "object" && "humanTakeoverAt" in ref) {
    return Boolean(ref.humanTakeoverAt);
  }
  const row = await prisma.agentConversation.findUnique({
    where:  { id: String(ref) },
    select: { humanTakeoverAt: true },
  });
  return Boolean(row && row.humanTakeoverAt);
}

module.exports = {
  takeOverConversation,
  releaseConversation,
  isConversationPaused,
};
