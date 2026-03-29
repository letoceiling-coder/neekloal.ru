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

module.exports = { validateSalesReply, countSentences, countQuestions, hasNextStepCue };
