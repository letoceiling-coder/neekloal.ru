"use strict";

/**
 * Грубый подсчёт предложений (RU/EN).
 * @param {string} text
 * @returns {number}
 */
function countSentences(text) {
  const t = String(text).trim();
  if (!t) return 0;
  const chunks = t.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 0);
  if (chunks.length === 0) return 1;
  return chunks.length;
}

/**
 * @param {string} text
 * @returns {number}
 */
function countQuestions(text) {
  return (String(text).match(/\?/g) || []).length;
}

/**
 * Есть ли явный «следующий шаг» (призыв / уточнение).
 * @param {string} text
 * @returns {boolean}
 */
function hasNextStepCue(text) {
  const t = String(text).toLowerCase();
  return (
    /давайте|могу предложить|уточн|когда вам|как вам|напишите|позвон|следующ|шаг|оформи|демо|консультац|записать|отправлю|скинуть|связ|удобн/.test(
      t
    ) || /можем\s+(сейчас|завтра)/.test(t)
  );
}

/**
 * Для stage=close ответ ОБЯЗАН содержать предложение созвона/встречи.
 * @param {string} text
 * @returns {boolean}
 */
function hasCallCue(text) {
  const t = String(text).toLowerCase();
  return /созвон|созвониться|позвон|встреч|записать|запишу|когда вам удобно|удобн.*время|назначим|договоримся|обсудим по|по телефон|в zoom|онлайн встреч/.test(t);
}

/**
 * @param {string} reply
 * @returns {{ ok: boolean; reasons: string[] }}
 */
function validateSalesReply(reply) {
  const reasons = [];
  const text = String(reply ?? "").trim();
  if (!text) {
    reasons.push("empty");
    return { ok: false, reasons };
  }

  const sc = countSentences(text);
  if (sc > 3) {
    reasons.push(`sentences:${sc}>3`);
  }

  const qc = countQuestions(text);
  if (qc < 1) {
    reasons.push("questions:<1");
  }
  if (qc > 1) {
    reasons.push(`questions:${qc}>1`);
  }

  if (!hasNextStepCue(text)) {
    reasons.push("next_step:missing");
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Stage-aware validation.
 * For stage=close the reply MUST contain a call/meeting proposal — hard requirement.
 * For other stages falls back to generic validateSalesReply.
 *
 * @param {string} reply
 * @param {string} [stage]
 * @returns {{ ok: boolean; reasons: string[] }}
 */
function validateByStage(reply, stage) {
  const text = String(reply ?? "").trim();

  if (stage === "close") {
    const reasons = [];
    if (!text) {
      reasons.push("empty");
      return { ok: false, reasons };
    }
    if (!hasCallCue(text)) {
      reasons.push("close:no_call_cue — ответ ОБЯЗАН предложить созвон");
    }
    return { ok: reasons.length === 0, reasons };
  }

  // For objection stage: must have next-step cue
  if (stage === "objection") {
    const base = validateSalesReply(reply);
    return base;
  }

  // Default: generic check
  return validateSalesReply(reply);
}

module.exports = {
  validateSalesReply,
  validateByStage,
  countSentences,
  countQuestions,
  hasNextStepCue,
  hasCallCue,
};
