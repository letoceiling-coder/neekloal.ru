"use strict";

/**
 * avito.processor.js — BullMQ job processor for Avito messages.
 *
 * Full pipeline per message:
 *   1. Extract & validate job data
 *   2. Anti-loop guard (skip own messages)
 *   3. Load agent from DB
 *   4. Find-or-create AgentConversation (source="avito")
 *   5. CRM: create Lead on first contact
 *   6. Classify message
 *   7. Route → decision (autoreply | copilot | human | skip)
 *   8. If autoreply/copilot: call agentChatV2 (no external call for copilot)
 *   9. If autoreply: sendMessage to Avito (with 1 retry)
 *  10. Save AvitoAuditLog
 *
 * NOT_TOUCHING: agentRuntime.js (V1), any existing route outside /modules/avito
 */

const prisma                         = require("../../lib/prisma");
const { agentChatV2,
        findOrCreateExternalConversation } = require("../../services/agentRuntimeV2");
const { createClient }               = require("../../services/avitoClient");
const { classifyMessage }            = require("./avito.classifier");
const { routeMessage }               = require("./avito.router");
const { saveAudit }                  = require("./avito.audit");
const { maybeCreateLead }            = require("./avito.crm");

// ── Retry helper ──────────────────────────────────────────────────────────────

/**
 * Call `fn()`, and if it throws retry once after `delayMs`.
 * @param {Function} fn
 * @param {number}   delayMs
 * @returns {Promise<any>}
 */
async function retryOnce(fn, delayMs = 2_000) {
  try {
    return await fn();
  } catch (firstErr) {
    process.stderr.write(`[avito:send] first attempt failed (${firstErr.message}) — retrying in ${delayMs}ms\n`);
    await new Promise((r) => setTimeout(r, delayMs));
    return await fn();   // throws on second failure — BullMQ will catch
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

/**
 * Process a single "avito_message" BullMQ job.
 * Exported and used as the BullMQ Worker processor function.
 *
 * @param {import("bullmq").Job} job
 */
async function processAvitoJob(job) {
  const { agentId, eventId, chatId, authorId, text } = job.data ?? {};
  const startMs = Date.now();

  process.stdout.write(
    `[avito:processor] start job=${job.id} agentId=${agentId} chatId=${chatId} ` +
    `from=${authorId} text="${String(text ?? "").slice(0, 60)}"\n`
  );

  // Audit state — populated as pipeline progresses
  const audit = {
    agentId,
    organizationId: null,
    chatId,
    authorId,
    conversationId: null,
    eventId,
    input:          text,
    output:         null,
    classification: null,
    decision:       "unknown",
    modelUsed:      null,
    tokens:         null,
    durationMs:     null,
    success:        true,
    error:          null,
  };

  try {
    // ── 1. Validate ─────────────────────────────────────────────────────────
    if (!agentId || !chatId || !authorId) {
      throw new Error(`Invalid job data: missing agentId/chatId/authorId`);
    }

    // ── 2. Load agent ────────────────────────────────────────────────────────
    const agent = await prisma.agent.findFirst({
      where:   { id: agentId, deletedAt: null },
      include: { avitoAccount: true },        // includes AvitoAccount if linked
    });
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    audit.organizationId = agent.organizationId;

    // ── Resolve Avito credentials ─────────────────────────────────────────────
    // Priority: linked AvitoAccount (DB) → env vars (legacy fallback)
    let avitoClient = null;
    let myAccountId = null;

    if (agent.avitoAccount?.isActive) {
      const acc = agent.avitoAccount;
      myAccountId = acc.accountId;
      try {
        avitoClient = createClient({ token: acc.accessToken, accountId: acc.accountId });
        process.stdout.write(`[avito:processor] using DB account id=${acc.id} name="${acc.name ?? ""}"\n`);
      } catch (e) {
        process.stderr.write(`[avito:processor] DB account credentials invalid: ${e.message}\n`);
      }
    } else if (process.env.AVITO_TOKEN && process.env.AVITO_ACCOUNT_ID) {
      myAccountId = process.env.AVITO_ACCOUNT_ID;
      try {
        avitoClient = createClient({
          token:     process.env.AVITO_TOKEN,
          accountId: process.env.AVITO_ACCOUNT_ID,
        });
        process.stdout.write(`[avito:processor] using env-based Avito credentials (legacy)\n`);
      } catch (e) {
        process.stderr.write(`[avito:processor] env credentials invalid: ${e.message}\n`);
      }
    }

    // ── 3. Anti-loop ─────────────────────────────────────────────────────────
    if (myAccountId && String(authorId) === String(myAccountId)) {
      process.stdout.write(`[avito:processor] skip own message chatId=${chatId}\n`);
      audit.decision = "skip";
      return; // no audit save for self-messages (noise)
    }

    // ── 4. Find or create conversation ───────────────────────────────────────
    const conv = await findOrCreateExternalConversation(
      agentId,
      agent.organizationId,
      chatId,
      authorId,
      "avito"
    );
    audit.conversationId = conv.id;

    const isFirstMessage = !Array.isArray(conv.messages) || conv.messages.length === 0;

    // ── 5. CRM: first contact ────────────────────────────────────────────────
    if (isFirstMessage) {
      // We call classification early for the isHotLead flag
      const earlyClass = classifyMessage(text);
      audit.classification = earlyClass;
      await maybeCreateLead({
        organizationId: agent.organizationId,
        chatId,
        authorId,
        firstMessage:   text,
        isHotLead:      earlyClass.isHotLead,
      });
    }

    // ── 6. Classify ──────────────────────────────────────────────────────────
    const classification = audit.classification ?? classifyMessage(text);
    audit.classification  = classification;

    // ── 7. Route ─────────────────────────────────────────────────────────────
    const routing = routeMessage(agent, classification);
    audit.decision = routing.decision;

    process.stdout.write(
      `[avito:router] decision=${routing.decision} reason="${routing.reason}"\n`
    );

    if (routing.decision === "skip" || routing.decision === "human") {
      // Human mode: message already saved in conversation by findOrCreate logic
      // (agentChatV2 will persist it when called; for "human" we just skip AI)
      audit.success = true;
      return;
    }

    // ── 8. AI response (autoreply OR copilot) ────────────────────────────────
    const systemPrompt = agent.rules?.trim() || null;

    let aiResult;
    try {
      aiResult = await agentChatV2({
        conversationId: conv.id,
        message:        text,
        organizationId: agent.organizationId,
        systemPrompt,
        model: agent.model || null,
      });
    } catch (aiErr) {
      audit.error   = `agentChatV2: ${aiErr.message}`;
      audit.success = false;
      throw aiErr; // let BullMQ retry the whole job
    }

    audit.output    = aiResult.reply;
    audit.modelUsed = aiResult.modelUsed;
    audit.tokens    = aiResult.tokens?.total ?? null;

    process.stdout.write(
      `[avito:processor] AI reply model=${aiResult.modelUsed} chars=${aiResult.reply.length}\n`
    );

    // ── 9. Send to Avito (autoreply only, copilot saves to DB only) ──────────
    if (routing.decision === "autoreply") {
      if (!avitoClient) {
        process.stderr.write(
          `[avito:processor] no Avito credentials — reply saved to DB but NOT sent chatId=${chatId}\n`
        );
      } else {
        await retryOnce(() => avitoClient.sendMessage(chatId, aiResult.reply));
      }
    } else {
      // copilot: reply is saved in DB via agentChatV2, but NOT sent to Avito
      process.stdout.write(
        `[avito:processor] copilot: reply saved to DB chatId=${chatId} — NOT sent\n`
      );
    }

  } catch (err) {
    audit.success = false;
    audit.error   = err.message;
    process.stderr.write(`[avito:processor] ✗ job=${job.id} err="${err.message}"\n`);
    throw err; // re-throw so BullMQ marks the job as failed / retries
  } finally {
    audit.durationMs = Date.now() - startMs;
    // Always save audit (except self-messages where we return early)
    if (audit.organizationId) {
      await saveAudit(audit);
    }
  }
}

module.exports = { processAvitoJob };
