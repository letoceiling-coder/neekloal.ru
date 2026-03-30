"use strict";

/**
 * Простой rule-based intent для продающего диалога (RU).
 * @param {unknown} message
 * @param {{ intents?: Record<string, string[]> } | null} [config]
 *   Optional assistant config. If provided and config.intents exists,
 *   those keyword lists replace the built-in INTENTS (safe patch — fully backward-compatible).
 * @returns {{ intent: string }}
 */

// ─── Built-in defaults (used when no config.intents supplied) ───────────────
const DEFAULT_INTENTS = {
  pricing:            ["цена", "стоимость", "сколько", "бюджет", "ценник"],
  objection:          ["дорого", "дороговато", "слишком дорого"],
  qualification_site: ["сайт", "лендинг"],
};

const DEFAULT_CLOSE_HINTS = ["куплю", "оформ", "оплат", "заключаем", "давайте договор"];

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function anyIncludes(text, arr) {
  if (!Array.isArray(arr)) return false;
  for (const w of arr) {
    if (w && text.includes(w)) return true;
  }
  return false;
}

/**
 * @param {unknown} message
 * @param {{ intents?: Record<string, string[]> } | null} [config]
 * @returns {{ intent: string }}
 */
function detectIntent(message, config) {
  const t = normalize(message);
  if (!t) return { intent: "unknown" };

  // ── Config-driven path (when assistant provides custom intents) ────────────
  if (config && config.intents && typeof config.intents === "object") {
    for (const [intent, keywords] of Object.entries(config.intents)) {
      if (anyIncludes(t, keywords)) {
        return { intent };
      }
    }
    // No match in custom intents — fall through to built-in defaults as secondary check
  }

  // ── Built-in path (backward-compatible, runs when no config.intents) ──────
  // Priority: objection → close → pricing → qualification_site
  if (anyIncludes(t, DEFAULT_INTENTS.objection)) return { intent: "objection" };
  if (anyIncludes(t, DEFAULT_CLOSE_HINTS) || anyIncludes(t, ["хочу купить", "готов купить"])) {
    return { intent: "close" };
  }
  if (anyIncludes(t, DEFAULT_INTENTS.pricing) || /\bруб/.test(t) || t.includes("сколько стоит")) {
    return { intent: "pricing" };
  }
  if (anyIncludes(t, DEFAULT_INTENTS.qualification_site)) return { intent: "qualification_site" };

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
