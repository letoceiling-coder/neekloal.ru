"use strict";

// ─── Human-readable labels for known stage/intent/memory names ───────────────

const STAGE_LABELS = {
  greeting:      "Приветствие",
  qualification: "Знакомство с задачей",
  offer:         "Предложение",
  objection:     "Работа с возражениями",
  close:         "Закрытие сделки",
  intro:         "Вход в диалог",
  demo:          "Демонстрация",
  proposal:      "Коммерческое предложение",
  closed:        "Сделка закрыта",
};

const STAGE_DESCRIPTIONS = {
  greeting:      "AI приветствует клиента и устанавливает первый контакт",
  qualification: "AI уточняет задачу, бюджет и потребности клиента",
  offer:         "AI представляет подходящее решение и называет стоимость",
  objection:     "AI работает с возражениями и объясняет ценность",
  close:         "AI предлагает следующий шаг — созвон или договор",
  intro:         "AI начинает диалог с клиентом",
  demo:          "AI демонстрирует продукт или услугу",
  proposal:      "AI отправляет коммерческое предложение",
  closed:        "Сделка завершена успешно",
};

const STAGE_ICONS = {
  greeting:      "👋",
  qualification: "🔍",
  offer:         "💡",
  objection:     "🛡️",
  close:         "🤝",
  intro:         "🚪",
  demo:          "🎥",
  proposal:      "📄",
  closed:        "✅",
};

const INTENT_LABELS = {
  pricing:            "Запрос цены",
  objection:          "Возражение по цене",
  qualification:      "Интерес к продукту",
  qualification_site: "Запрос об услуге",
  close:              "Готовность купить",
};

const INTENT_ICONS = {
  pricing:            "💰",
  objection:          "🤔",
  qualification:      "❓",
  qualification_site: "❓",
  close:              "✅",
};

const MEMORY_META = {
  budget:      { label: "Бюджет клиента",  desc: "Сколько клиент готов потратить",    icon: "💰" },
  projectType: { label: "Тип задачи",      desc: "Что именно нужно клиенту",           icon: "📋" },
  timeline:    { label: "Срок",            desc: "Когда нужен результат",              icon: "📅" },
  contactName: { label: "Имя клиента",     desc: "Как обращаться к клиенту",           icon: "👤" },
  phone:       { label: "Телефон",         desc: "Контакт для обратной связи",         icon: "📞" },
};

const STAGE_EXAMPLE_USER = {
  greeting:      "Здравствуйте, расскажите что вы предлагаете?",
  qualification: "Мне нужно ваше решение. Хотел бы уточнить детали.",
  offer:         "Сколько это будет стоить?",
  objection:     "Это кажется довольно дорого...",
  close:         "Хорошо, давайте договоримся.",
};

const STAGE_EXAMPLE_AI = {
  greeting:      "Добрый день! Я помогу вам разобраться. Что именно вас интересует?",
  qualification: "Отлично! Уточните, пожалуйста: какой объём и в какие сроки вы планируете?",
  offer:         "Для вашей задачи оптимальное решение обойдётся от X рублей. Что для вас в приоритете?",
  objection:     "Понимаю. Стоит учесть, что в стоимость входит [ценность]. Что для вас важнее всего?",
  close:         "Отлично! Предлагаю обсудить детали на коротком звонке. Когда вам удобно?",
};

/**
 * Convert raw auto-agent config into human-readable explanation blocks.
 * Pure function — no LLM call, instant, deterministic.
 *
 * @param {Record<string, unknown>} config
 * @param {string} systemPrompt
 * @returns {object}
 */
function explainConfig(config, systemPrompt) {
  const funnel  = Array.isArray(config?.funnel)    ? config.funnel    : [];
  const intents = (config?.intents && typeof config.intents === "object") ? config.intents : {};
  const memory  = Array.isArray(config?.memory)    ? config.memory    : [];
  const validation = config?.validation ?? {};

  // ── Summary ────────────────────────────────────────────────────────────────
  const firstSentence = systemPrompt
    ? systemPrompt.split(/[.!?]/)[0].trim() + "."
    : "AI ассистент для вашего бизнеса.";
  const summary =
    firstSentence +
    (funnel.length > 0
      ? ` Ведёт клиента через ${funnel.length} этапов: от знакомства до сделки.`
      : "");

  // ── Funnel description ─────────────────────────────────────────────────────
  const funnelDescription = funnel.map((stage, i) => ({
    step: i + 1,
    stage,
    label:       STAGE_LABELS[stage]       ?? stage,
    icon:        STAGE_ICONS[stage]        ?? "📍",
    description: STAGE_DESCRIPTIONS[stage] ?? `AI переходит к этапу "${stage}"`,
  }));

  // ── Intents description ────────────────────────────────────────────────────
  const intentsDescription = Object.entries(intents).map(([intent, keywords]) => ({
    intent,
    label:       INTENT_LABELS[intent] ?? intent,
    icon:        INTENT_ICONS[intent]  ?? "💬",
    triggers:    Array.isArray(keywords) ? keywords.slice(0, 4) : [],
    description: `Клиент произносит: ${
      Array.isArray(keywords) ? keywords.slice(0, 3).join(", ") : ""
    }`,
  }));

  // ── Memory description ─────────────────────────────────────────────────────
  const memoryDescription = memory.map((field) => ({
    field,
    ...(MEMORY_META[field] ?? { label: field, desc: `Запоминает "${field}"`, icon: "📝" }),
  }));

  // ── Example dialog (first 3 funnel stages) ─────────────────────────────────
  const dialogStages = funnel.slice(0, Math.min(3, funnel.length));
  const exampleDialog = dialogStages.flatMap((stage) => [
    {
      role: "user",
      text: STAGE_EXAMPLE_USER[stage] ?? `Сообщение клиента на этапе "${stage}"`,
    },
    {
      role: "ai",
      text:       STAGE_EXAMPLE_AI[stage] ?? `AI отвечает на этапе "${stage}"`,
      stage,
      stageLabel: STAGE_LABELS[stage] ?? stage,
    },
  ]);

  return {
    summary,
    funnelDescription,
    intentsDescription,
    memoryDescription,
    exampleDialog,
    meta: {
      stagesCount:       funnel.length,
      intentsCount:      Object.keys(intents).length,
      memoryFieldsCount: memory.length,
      maxSentences:      typeof validation.maxSentences === "number" ? validation.maxSentences : 3,
    },
  };
}

module.exports = { explainConfig };
