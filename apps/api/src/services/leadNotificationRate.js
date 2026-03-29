"use strict";

/**
 * Ограничение частоты уведомлений о лидах (антиспам, защита каналов).
 * Env:
 *   LEAD_NOTIFY_MAX_PER_ORG_PER_HOUR — по умолчанию 120
 *   LEAD_NOTIFY_LEAD_DEDUP_MS — не слать повторно по тому же leadId, мс (по умолчанию 120000)
 */

const ORG_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_MAX_PER_ORG_PER_HOUR = 120;
const DEFAULT_LEAD_DEDUP_MS = 120_000;

/** @type {Map<string, { count: number, resetAt: number }>} */
const orgBuckets = new Map();
/** @type {Map<string, number>} */
const leadLastNotifyAt = new Map();

function maxPerOrgPerHour() {
  const n = Number(process.env.LEAD_NOTIFY_MAX_PER_ORG_PER_HOUR);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_PER_ORG_PER_HOUR;
  }
  return Math.min(10_000, Math.floor(n));
}

function leadDedupMs() {
  const n = Number(process.env.LEAD_NOTIFY_LEAD_DEDUP_MS);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_LEAD_DEDUP_MS;
  }
  return Math.min(86_400_000, Math.floor(n));
}

/**
 * @param {string} organizationId
 * @param {string} leadId
 * @returns {boolean} true — можно отправить
 */
function tryAcquireLeadNotify(organizationId, leadId) {
  const org = String(organizationId ?? "").trim();
  const lead = String(leadId ?? "").trim();
  if (!org || !lead) {
    return false;
  }

  const now = Date.now();
  const dedupMs = leadDedupMs();
  const prev = leadLastNotifyAt.get(lead);
  if (prev != null && now - prev < dedupMs) {
    return false;
  }

  let b = orgBuckets.get(org);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + ORG_WINDOW_MS };
    orgBuckets.set(org, b);
  }

  const cap = maxPerOrgPerHour();
  if (b.count >= cap) {
    return false;
  }

  b.count += 1;
  leadLastNotifyAt.set(lead, now);

  if (leadLastNotifyAt.size > 5000) {
    const cutoff = now - dedupMs * 2;
    leadLastNotifyAt.forEach((t, k) => {
      if (t < cutoff) {
        leadLastNotifyAt.delete(k);
      }
    });
  }

  return true;
}

module.exports = {
  tryAcquireLeadNotify,
  DEFAULT_MAX_PER_ORG_PER_HOUR,
  DEFAULT_LEAD_DEDUP_MS,
};
