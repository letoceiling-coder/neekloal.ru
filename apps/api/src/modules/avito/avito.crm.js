"use strict";

/**
 * avito.crm.js — CRM lead creation + status sync for Avito channel.
 *
 * Creates a Lead in the CRM system when a new Avito user contacts
 * an agent for the first time (identified by authorId).
 *
 * Also exposes syncLeadStatus() to keep the CRM Lead in sync with
 * the AvitoLead FSM state after each message.
 *
 * Uses the existing Lead model with source="avito".
 * Idempotent: does nothing if a lead already exists for this Avito user.
 */

const prisma = require("../../lib/prisma");

// ── FSM → CRM status map ──────────────────────────────────────────────────────

/**
 * Map AvitoLead FSM status to CRM LeadPipelineStatus enum value.
 * @param {string} avitoStatus
 * @returns {string}
 */
function mapToCrmStatus(avitoStatus) {
  switch (avitoStatus) {
    case "QUALIFYING":  return "CONTACTED";
    case "INTERESTED":  return "QUALIFIED";
    case "HANDOFF":     return "QUALIFIED";
    case "CLOSED":      return "WON";
    case "LOST":        return "LOST";
    default:            return "NEW";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a CRM lead for a new Avito contact, if one doesn't exist yet.
 *
 * @param {{
 *   organizationId: string,
 *   chatId:         string,
 *   authorId:       string,
 *   firstMessage:   string,
 *   isHotLead:      boolean,
 *   avitoStatus?:   string,
 * }} params
 * @returns {Promise<object|null>}   Created Lead row, or null if already existed
 */
async function maybeCreateLead({ organizationId, chatId, authorId, firstMessage, isHotLead, avitoStatus }) {
  // Idempotency: one lead per Avito authorId per org
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId,
      source: "avito",
      phone:  String(authorId),
    },
  });

  if (existing) {
    process.stdout.write(`[avito:crm] lead already exists id=${existing.id} authorId=${authorId}\n`);
    return null;
  }

  const crmStatus = mapToCrmStatus(avitoStatus ?? "NEW");

  try {
    const lead = await prisma.lead.create({
      data: {
        organizationId,
        name:         `Avito ${authorId}`,
        phone:        String(authorId),
        source:       "avito",
        status:       crmStatus,
        firstMessage: firstMessage.slice(0, 1_000),
      },
    });

    process.stdout.write(
      `[avito:crm] ✓ created lead id=${lead.id} authorId=${authorId} ` +
      `hotLead=${isHotLead} crmStatus=${crmStatus} chatId=${chatId}\n`
    );
    return lead;
  } catch (err) {
    process.stderr.write(`[avito:crm] createLead failed: ${err.message}\n`);
    return null;
  }
}

/**
 * Update the CRM Lead status to match the current AvitoLead FSM state.
 * Non-fatal — CRM failure must never block the AI pipeline.
 *
 * @param {{ organizationId: string, authorId: string, avitoStatus: string }} params
 */
async function syncLeadStatus({ organizationId, authorId, avitoStatus }) {
  const crmStatus = mapToCrmStatus(avitoStatus);
  try {
    const lead = await prisma.lead.findFirst({
      where: { organizationId, source: "avito", phone: String(authorId) },
    });
    if (!lead) return;

    if (lead.status !== crmStatus) {
      await prisma.lead.update({
        where: { id: lead.id },
        data:  { status: crmStatus },
      });
      process.stdout.write(
        `[avito:crm] synced lead id=${lead.id} ${lead.status} → ${crmStatus}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`[avito:crm] syncLeadStatus failed: ${err.message}\n`);
  }
}

module.exports = { maybeCreateLead, syncLeadStatus };
