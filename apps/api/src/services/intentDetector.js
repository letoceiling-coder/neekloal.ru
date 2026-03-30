"use strict";

/**
 * Простой rule-based intent для продающего диалога (RU).
 * @param {unknown} message
 * @returns {{ intent: "pricing" | "objection" | "qualification_site" | "close" | "unknown" }}
 */
const INTENTS = {
  pricing: ["цена", "стоимость", "сколько", "бюджет", "ценник"],
  objection: ["дорого", "дороговато", "слишком дорого"],
  qualification_site: ["сайт", "лендинг"],
};

// Доп. close-эвристики (в задаче явно не перечислены, но FSM стадия close ожидается).
const CLOSE_HINTS = ["куплю", "оформ", "оплат", "заключаем", "давайте договор"];

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function anyIncludes(text, arr) {
  for (const w of arr) {
    if (w && text.includes(w)) return true;
  }
  return false;
}

function detectIntent(message) {
  const t = normalize(message);
  if (!t) return { intent: "unknown" };

  // Приоритет: возражения → close → pricing → qualification_site
  if (anyIncludes(t, INTENTS.objection)) return { intent: "objection" };
  if (anyIncludes(t, CLOSE_HINTS) || anyIncludes(t, ["хочу купить", "готов купить"])) {
    return { intent: "close" };
  }
  if (anyIncludes(t, INTENTS.pricing) || /\bруб/.test(t) || t.includes("сколько стоит")) {
    return { intent: "pricing" };
  }
  if (anyIncludes(t, INTENTS.qualification_site)) return { intent: "qualification_site" };

  // Расширение qualification_site для реальных формулировок
  if (
    t.includes("интернет-магазин") ||
    t.includes("интернет магазин") ||
    t.includes("нужен сайт") ||
    t.includes("разработк") ||
    t.includes("хочу проект")
  ) {
    return { intent: "qualification_site" };
  }

  return { intent: "unknown" };
}

module.exports = { detectIntent };
