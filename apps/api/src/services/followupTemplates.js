"use strict";

/**
 * followupTemplates.js — per-organization follow-up sequence resolution.
 *
 * The Avito follow-up pipeline historically used hard-coded steps/messages
 * (avito.followup.queue.js::STEPS and avito.followup.processor.js::FOLLOW_UP_MESSAGES).
 * This service lets orgs customise the sequence via admin UI, while
 * transparently falling back to the old hard-coded defaults when the org
 * has not configured anything yet (or all templates are disabled).
 *
 * Output shape of resolveFollowUpSequence():
 *   [
 *     { step: 1, delayMs: 5*60_000,  text: "Добрый день! …" },
 *     { step: 2, delayMs: 15*60_000, text: "Хотел уточнить …" },
 *     …
 *   ]
 */

const prisma = require("../lib/prisma");

// ── Defaults (must mirror avito.followup.queue.STEPS / processor FOLLOW_UP_MESSAGES) ──

const DEFAULT_SEQUENCE = [
  { step: 1, delayMinutes:  5, text: "Добрый день! Остались вопросы? Готов помочь с выбором 😊" },
  { step: 2, delayMinutes: 15, text: "Хотел уточнить — вы ещё рассматриваете наше предложение? Могу ответить на любые вопросы." },
  { step: 3, delayMinutes: 60, text: "Последнее сообщение — если передумали, буду рад помочь в любое время. Удачного дня! 🙏" },
];

const DB_FAILURE_LOG_PREFIX = "[followup:templates]";

/** @returns {Array<{step:number,delayMinutes:number,text:string}>} */
function getDefaultSequence() {
  return DEFAULT_SEQUENCE.map((s) => ({ ...s }));
}

/**
 * Load active follow-up templates for an organization, sorted by step.
 * Returns an empty array if none are configured (DB failures log + fall back).
 * @param {string|null|undefined} organizationId
 */
async function loadOrgTemplates(organizationId) {
  if (!organizationId) return [];
  try {
    const rows = await prisma.organizationFollowUpTemplate.findMany({
      where:   { organizationId, isActive: true },
      orderBy: { step: "asc" },
    });
    return rows;
  } catch (err) {
    process.stderr.write(
      `${DB_FAILURE_LOG_PREFIX} load failed org=${organizationId}: ${err.message}\n`
    );
    return [];
  }
}

/**
 * Resolve the effective follow-up sequence for the given organization.
 * Falls back to the hard-coded DEFAULT_SEQUENCE when the org has zero
 * active templates (preserves previous behaviour for orgs that never
 * touched the admin UI).
 *
 * @param {string|null|undefined} organizationId
 * @returns {Promise<Array<{step:number,delayMs:number,text:string}>>}
 */
async function resolveFollowUpSequence(organizationId) {
  const rows = await loadOrgTemplates(organizationId);

  const source = rows.length > 0 ? rows : getDefaultSequence();

  return source.map((r) => ({
    step:    Number(r.step) || 1,
    delayMs: Math.max(1, Number(r.delayMinutes) || 1) * 60 * 1000,
    text:    String(r.text || "").trim(),
  })).filter((s) => s.text.length > 0);
}

/**
 * Resolve the text of a specific step for a given org.
 * Falls back to DEFAULT_SEQUENCE if the org has no active template at that step.
 * Returns null if no text is available at all.
 *
 * @param {string|null|undefined} organizationId
 * @param {number} step
 * @returns {Promise<string|null>}
 */
async function resolveStepText(organizationId, step) {
  const seq = await resolveFollowUpSequence(organizationId);
  const hit = seq.find((s) => s.step === Number(step));
  if (hit) return hit.text;
  // absolute last resort: take the last entry in the sequence / defaults
  if (seq.length) return seq[seq.length - 1].text;
  return null;
}

module.exports = {
  DEFAULT_SEQUENCE,
  getDefaultSequence,
  loadOrgTemplates,
  resolveFollowUpSequence,
  resolveStepText,
};
