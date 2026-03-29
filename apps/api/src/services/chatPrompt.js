"use strict";

/**
 * Единый сборщик промпта для chat + agent (Ollama generate).
 *
 * @param {object} p
 * @param {object} p.assistant — строка Prisma Assistant (нужны systemPrompt)
 * @param {string} [p.systemPrompt] — переопределение SYSTEM (например виджет с appendWidgetSalesPrompt)
 * @param {{ rules?: string|null }|null} [p.agent] — если есть rules, блок AGENT
 * @param {string} [p.knowledge] — RAG / документы
 * @param {unknown} p.message — пользовательское сообщение
 * @param {string} [p.fsmStage] — этап воронки (greeting | qualification | offer | …)
 * @param {string} [p.appendAfterUser] — доп. блок после USER (история tool results, инструкции JSON)
 * @returns {string}
 */
function buildFinalPrompt(p) {
  const assistant = p.assistant;
  const sys = String(
    p.systemPrompt != null ? p.systemPrompt : assistant?.systemPrompt ?? ""
  ).trim();
  const kb = p.knowledge != null ? String(p.knowledge).trim() : "";
  const userMsg = p.message == null ? "" : String(p.message).trim();

  let agentRules = "";
  if (p.agent && p.agent.rules != null && String(p.agent.rules).trim() !== "") {
    agentRules = String(p.agent.rules).trim();
  }

  const fsm =
    p.fsmStage != null && String(p.fsmStage).trim() !== ""
      ? String(p.fsmStage).trim()
      : "";

  const parts = [`SYSTEM:\n${sys}\n\nОтвечай только на русском языке.`];
  if (agentRules) {
    parts.push(`AGENT:\n${agentRules}`);
  }
  if (fsm) {
    parts.push(
      `FSM:\nТекущий этап: ${fsm}\n` +
        `Веди диалог как менеджер: учитывай этап, двигай к следующему шагу воронки, будь кратким.`
    );
  }
  parts.push(`KNOWLEDGE:\n${kb || "(none)"}`);

  let userBlock = `USER:\n${userMsg}`;
  if (p.appendAfterUser != null && String(p.appendAfterUser).trim() !== "") {
    userBlock += `\n\n${String(p.appendAfterUser).trim()}`;
  }
  parts.push(userBlock);

  return parts.join("\n\n");
}

module.exports = { buildFinalPrompt };
