"use strict";

/**
 * avito.fsm.js — Sales FSM (Finite State Machine) for Avito channel.
 *
 * States (ordered by pipeline depth):
 *   NEW         — first contact, no intent detected yet
 *   QUALIFYING  — showed price / product interest
 *   INTERESTED  — strong buying signal (ready_to_buy)
 *   HANDOFF     — phone detected OR explicit contact_request → human takes over
 *   CLOSED      — deal closed
 *   LOST        — lost interest
 *
 * Transitions are irreversible for high-priority states
 * (HANDOFF/CLOSED/LOST cannot be downgraded).
 */

// Numeric priority for each state — used to prevent downgrade
const STATE_PRIORITY = {
  NEW:        0,
  QUALIFYING: 1,
  INTERESTED: 2,
  HANDOFF:    3,
  CLOSED:     4,
  LOST:       4,
};

/**
 * Resolve the next FSM state for a lead given the latest classification.
 * Never downgrades below current state priority.
 *
 * @param {{ status: string }}                     lead
 * @param {{ intent: string, isHotLead: boolean }} classification
 * @returns {string}  Next status (same as lead.status if no upgrade)
 */
function resolveNextState(lead, classification) {
  const { intent } = classification;

  let candidate = lead.status;

  if (intent === "price_inquiry")   candidate = "QUALIFYING";
  if (intent === "ready_to_buy")    candidate = "INTERESTED";
  if (intent === "contact_request") candidate = "HANDOFF";

  // Never downgrade
  const currentPrio = STATE_PRIORITY[lead.status]  ?? 0;
  const candidatePrio = STATE_PRIORITY[candidate]  ?? 0;

  return candidatePrio > currentPrio ? candidate : lead.status;
}

/**
 * Extract the first Russian phone number from a message text.
 * Matches +79991234567 or 79991234567 or 89991234567 (10+ digits).
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractPhone(text) {
  const match = (text || "").match(/(\+7\d{10}|[78]\d{10}|\d{10})/);
  return match ? match[0] : null;
}

/**
 * Build a sales-focused system prompt to prepend to the agent's own rules.
 * Adapts tone based on current FSM state.
 *
 * @param {{ status: string }} lead
 * @returns {string}
 */
function buildSalesPrompt(lead) {
  const stateHint =
    lead.status === "QUALIFYING" ? "Клиент интересуется ценой — уточни детали, не называй итоговую стоимость." :
    lead.status === "INTERESTED" ? "Клиент готов купить — уточни детали сделки и предложи оставить контакт." :
    "Выясни потребность клиента.";

  return `Ты — менеджер по продажам. Статус клиента в воронке: ${lead.status}.
${stateHint}

Правила:
— задавай 1 уточняющий вопрос за раз
— выявляй потребность и бюджет клиента
— веди диалог к получению контактных данных
— не называй финальную цену без уточнения деталей
— не обещай точные сроки
— не спорь с клиентом
— если клиент готов — попроси номер телефона или удобное время для звонка`;
}

module.exports = { resolveNextState, extractPhone, buildSalesPrompt };
