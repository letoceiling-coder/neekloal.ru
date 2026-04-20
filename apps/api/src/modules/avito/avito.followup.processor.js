"use strict";

/**
 * avito.followup.processor.js — BullMQ job processor for follow-up messages.
 *
 * Pipeline per job:
 *   1. Load AvitoFollowUp row — verify it is still "pending"
 *   2. Load AvitoLead — skip if status is HANDOFF or CLOSED
 *   3. Load Agent + resolve Avito credentials
 *   4. Send follow-up message via Avito API
 *   5. Mark AvitoFollowUp as "sent"
 *   6. If step=3 and we did send → mark lead as LOST (no response in 60 min)
 *
 * Skip conditions (non-fatal, job completes successfully):
 *   - followUp.status !== "pending"  (already cancelled/sent)
 *   - lead.status === "HANDOFF"      (human handling — no automated sends)
 *   - lead.status === "CLOSED"       (deal done)
 *   - lead.status === "LOST"         (already lost)
 *   - No Avito credentials available
 *
 * Logs:
 *   [followup:send]    message sent
 *   [followup:skip]    job skipped + reason
 *   [followup:close]   lead marked LOST after step 3
 */

const prisma                     = require("../../lib/prisma");
const { createClient }           = require("../../services/avitoClient");
const { resolveAccountCredentials } = require("./avito.credentials");
const { resolveStepText }        = require("../../services/followupTemplates");

// ── Follow-up message templates (hard-coded fallback) ────────────────────────
//
// Used only if services/followupTemplates.js cannot resolve a text for the
// given step (DB failure, org misconfigured, etc). The canonical per-org
// sequence lives in OrganizationFollowUpTemplate.

const FOLLOW_UP_MESSAGES = {
  1: "Добрый день! Остались вопросы? Готов помочь с выбором 😊",
  2: "Хотел уточнить — вы ещё рассматриваете наше предложение? Могу ответить на любые вопросы.",
  3: "Последнее сообщение — если передумали, буду рад помочь в любое время. Удачного дня! 🙏",
};

// ── Main processor ────────────────────────────────────────────────────────────

/**
 * Process a single "avito-followup" BullMQ job.
 * @param {import("bullmq").Job} job
 */
async function processFollowUpJob(job) {
  const { followUpId, agentId, chatId, leadId, step } = job.data ?? {};

  process.stdout.write(
    `[followup:processor] start job=${job.id} step=${step} chatId=${chatId} fuId=${followUpId}\n`
  );

  // ── 1. Load follow-up row ────────────────────────────────────────────────
  const followUp = await prisma.avitoFollowUp.findUnique({ where: { id: followUpId } });

  if (!followUp) {
    process.stdout.write(`[followup:skip] fuId=${followUpId} not found\n`);
    return;
  }
  if (followUp.status !== "pending") {
    process.stdout.write(
      `[followup:skip] fuId=${followUpId} status=${followUp.status} (not pending)\n`
    );
    return;
  }

  // ── 2. Load lead — check FSM state ──────────────────────────────────────
  const lead = await prisma.avitoLead.findUnique({ where: { id: leadId } });

  if (!lead) {
    process.stdout.write(`[followup:skip] leadId=${leadId} not found\n`);
    await prisma.avitoFollowUp.update({ where: { id: followUpId }, data: { status: "cancelled" } });
    return;
  }

  const skipStatuses = ["HANDOFF", "CLOSED", "LOST"];
  if (skipStatuses.includes(lead.status)) {
    process.stdout.write(
      `[followup:skip] chatId=${chatId} lead.status=${lead.status} — no follow-up needed\n`
    );
    await prisma.avitoFollowUp.update({ where: { id: followUpId }, data: { status: "cancelled" } });
    return;
  }

  // ── 3. Load agent + resolve Avito credentials ────────────────────────────
  const agent = await prisma.agent.findFirst({
    where:   { id: agentId, deletedAt: null },
    include: { avitoAccount: true },
  });

  if (!agent) {
    process.stderr.write(`[followup:skip] agent ${agentId} not found\n`);
    return;
  }

  let avitoClient = null;
  if (agent.avitoAccount?.isActive) {
    const acc = agent.avitoAccount;
    try {
      const creds = await resolveAccountCredentials(acc);
      avitoClient = createClient({ token: creds.accessToken, accountId: creds.accountId });
    } catch (e) {
      process.stderr.write(`[followup:processor] DB account invalid: ${e.message}\n`);
    }
  } else if (process.env.AVITO_TOKEN && process.env.AVITO_ACCOUNT_ID) {
    try {
      avitoClient = createClient({
        token:     process.env.AVITO_TOKEN,
        accountId: process.env.AVITO_ACCOUNT_ID,
      });
    } catch (e) {
      process.stderr.write(`[followup:processor] env credentials invalid: ${e.message}\n`);
    }
  }

  if (!avitoClient) {
    process.stderr.write(
      `[followup:skip] no Avito credentials — follow-up NOT sent chatId=${chatId}\n`
    );
    // Don't cancel — credentials might be restored; log and exit gracefully
    return;
  }

  // ── 4. Send follow-up message ────────────────────────────────────────────
  let message = null;
  try {
    message = await resolveStepText(agent.organizationId, step);
  } catch (err) {
    process.stderr.write(
      `[followup:processor] resolveStepText failed org=${agent.organizationId} step=${step}: ${err.message}\n`
    );
  }
  if (!message) {
    message = FOLLOW_UP_MESSAGES[step] ?? FOLLOW_UP_MESSAGES[3];
  }

  try {
    await avitoClient.sendMessage(chatId, message);
  } catch (sendErr) {
    process.stderr.write(
      `[followup:send] FAILED step=${step} chatId=${chatId}: ${sendErr.message}\n`
    );
    throw sendErr; // let BullMQ handle retry
  }

  // ── 5. Mark as sent ──────────────────────────────────────────────────────
  await prisma.avitoFollowUp.update({
    where: { id: followUpId },
    data:  { status: "sent", sentAt: new Date() },
  });

  process.stdout.write(
    `[followup:send] ✓ step=${step} chatId=${chatId} msg="${message.slice(0, 50)}"\n`
  );

  // ── 6. Auto-close: step=3 → lead status LOST ────────────────────────────
  if (step === 3) {
    await prisma.avitoLead.update({
      where: { id: leadId },
      data:  { status: "LOST" },
    });

    // Sync CRM lead as well
    try {
      const crmLead = await prisma.lead.findFirst({
        where: { source: "avito", phone: lead.externalUserId ?? "" },
      });
      if (crmLead) {
        await prisma.lead.update({ where: { id: crmLead.id }, data: { status: "LOST" } });
      }
    } catch { /* CRM sync failure is non-fatal */ }

    process.stdout.write(
      `[followup:close] step=3 sent → lead=${leadId} status=LOST chatId=${chatId}\n`
    );
  }
}

module.exports = { processFollowUpJob };
