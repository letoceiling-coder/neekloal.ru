"use strict";

/**
 * avito.crm.js — CRM lead creation for first-contact Avito users.
 *
 * Creates a Lead in the CRM system when a new Avito user contacts
 * an agent for the first time (identified by authorId).
 *
 * Uses the existing Lead model with source="avito".
 * Idempotent: does nothing if a lead already exists for this Avito user.
 */

const prisma = require("../../lib/prisma");

/**
 * Create a CRM lead for a new Avito contact, if one doesn't exist yet.
 *
 * @param {{
 *   organizationId: string,
 *   chatId:         string,
 *   authorId:       string,
 *   firstMessage:   string,
 *   isHotLead:      boolean,
 * }} params
 * @returns {Promise<object|null>}   Created Lead row, or null if already existed
 */
async function maybeCreateLead({ organizationId, chatId, authorId, firstMessage, isHotLead }) {
  // Check idempotency: one lead per Avito authorId per org
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId,
      source: "avito",
      phone:  String(authorId),   // using phone field as external id
    },
  });

  if (existing) {
    process.stdout.write(`[avito:crm] lead already exists id=${existing.id} authorId=${authorId}\n`);
    return null;
  }

  try {
    const lead = await prisma.lead.create({
      data: {
        organizationId,
        name:         `Avito ${authorId}`,
        phone:        String(authorId),
        source:       "avito",
        status:       isHotLead ? "NEW" : "NEW",  // always NEW; pipeline can promote to QUALIFIED
        firstMessage: firstMessage.slice(0, 1_000),
      },
    });

    process.stdout.write(
      `[avito:crm] ✓ created lead id=${lead.id} authorId=${authorId} ` +
      `hotLead=${isHotLead} chatId=${chatId}\n`
    );
    return lead;
  } catch (err) {
    // Non-fatal: CRM failure must never block AI response
    process.stderr.write(`[avito:crm] createLead failed: ${err.message}\n`);
    return null;
  }
}

module.exports = { maybeCreateLead };
