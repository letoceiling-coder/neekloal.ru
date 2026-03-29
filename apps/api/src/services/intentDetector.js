"use strict";

/**
 * Простой rule-based intent для продающего диалога (RU).
 * @param {unknown} message
 * @returns {{ intent: "pricing" | "objection" | "qualification_site" | "close" | "unknown" }}
 */
function detectIntent(message) {
  const t = String(message ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!t) {
    return { intent: "unknown" };
  }

  if (
    t.includes("дорого") ||
    t.includes("не готов") ||
    t.includes("подумаю") ||
    t.includes("возраж") ||
    t.includes("не уверен")
  ) {
    return { intent: "objection" };
  }

  if (
    t.includes("куплю") ||
    t.includes("оформ") ||
    t.includes("оплат") ||
    t.includes("заключаем") ||
    t.includes("давайте договор")
  ) {
    return { intent: "close" };
  }

  if (
    t.includes("цена") ||
    t.includes("цену") ||
    t.includes("стоим") ||
    t.includes("сколько стоит") ||
    t.includes("тариф") ||
    t.includes("прайс") ||
    /\bруб/.test(t)
  ) {
    return { intent: "pricing" };
  }

  if (
    t.includes("сайт") ||
    t.includes("лендинг") ||
    t.includes("интернет-магазин") ||
    t.includes("интернет магазин") ||
    t.includes("хочу проект") ||
    t.includes("нужен сайт") ||
    t.includes("разработк")
  ) {
    return { intent: "qualification_site" };
  }

  return { intent: "unknown" };
}

module.exports = { detectIntent };
