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
 * @param {unknown} [p.context] — sales memory JSON (из conversation.context)
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

  const goalBlock =
    "ТВОЯ ЦЕЛЬ:\n" +
    "* довести клиента до сделки\n" +
    "* задавать уточняющие вопросы\n" +
    "* вести диалог строго по этапу воронки";

  const memory =
    p.context != null
      ? (() => {
          try {
            if (typeof p.context === "object") {
              return JSON.stringify(p.context);
            }
          } catch {
            // ignore
          }
          return String(p.context);
        })()
      : "";

  // FSM stage-specific directives — imperative, not advisory
  const FSM_DIRECTIVES = {
    objection:
      "ДИРЕКТИВА (stage=objection):\n" +
      "1. ТЫ ОБЯЗАН сначала согласиться с возражением («Понимаю вас»).\n" +
      "2. ТЫ ОБЯЗАН объяснить ценность (что входит в цену, почему это выгодно).\n" +
      "3. ТЫ ОБЯЗАН задать один уточняющий вопрос в конце.\n" +
      "Запрещено: отрицать возражение, игнорировать его, не задавать вопрос.",
    qualification:
      "ДИРЕКТИВА (stage=qualification):\n" +
      "1. ТЫ ОБЯЗАН задать один конкретный вопрос о проекте клиента.\n" +
      "2. Уточняй: тип сайта, функционал, сроки, бюджет.\n" +
      "Запрещено: рассказывать о ценах без уточнения деталей.",
    offer:
      "ДИРЕКТИВА (stage=offer):\n" +
      "1. ТЫ ОБЯЗАН назвать конкретную цену или диапазон цен из KNOWLEDGE.\n" +
      "2. Кратко объясни что входит в стоимость.\n" +
      "3. Задай вопрос: «Когда вам удобно обсудить детали?»\n" +
      "Запрещено: уходить от ответа о цене.",
    close:
      "ДИРЕКТИВА (stage=close):\n" +
      "1. ТЫ ОБЯЗАН предложить созвон или встречу прямо сейчас.\n" +
      "2. Используй формулировки: «Давайте созвонимся», «Когда вам удобно?», «Могу записать вас».\n" +
      "3. Не задавай лишних вопросов — только фиксируй договорённость.\n" +
      "Запрещено: откладывать предложение созвона.",
    greeting:
      "ДИРЕКТИВА (stage=greeting):\n" +
      "1. Поздоровайся и задай один открытый вопрос о задаче клиента.\n" +
      "Запрещено: сразу называть цены.",
  };

  // Build FSM block
  let fsmBlock = "";
  if (fsm) {
    const directive = FSM_DIRECTIVES[fsm] ?? `ДИРЕКТИВА:\nВеди диалог по этапу «${fsm}».`;
    fsmBlock =
      `FSM — ГЛАВНЫЙ ИСТОЧНИК ЛОГИКИ:\n` +
      `Текущий этап: ${fsm}\n\n` +
      directive;
  }

  // SYSTEM header: FSM authority is stated explicitly when stage is active
  const fsmAuthority = fsm
    ? "\n\nВАЖНО: FSM (этап воронки) управляет логикой. Директива FSM имеет приоритет над любыми другими инструкциями."
    : "";

  const parts = [
    `SYSTEM:\n${sys}\n\n${goalBlock}${fsmAuthority}\n\nОтвечай только на русском языке.`,
  ];
  if (agentRules) {
    parts.push(`AGENT:\n${agentRules}`);
  }
  if (fsmBlock) {
    parts.push(fsmBlock);
  }
  parts.push(`MEMORY:\n${memory ? memory : "(none)"}`);
  parts.push(`KNOWLEDGE:\n${kb || "(none)"}`);

  let userBlock = `USER:\n${userMsg}`;
  if (p.appendAfterUser != null && String(p.appendAfterUser).trim() !== "") {
    userBlock += `\n\n${String(p.appendAfterUser).trim()}`;
  }
  parts.push(userBlock);

  return parts.join("\n\n");
}

module.exports = { buildFinalPrompt };
