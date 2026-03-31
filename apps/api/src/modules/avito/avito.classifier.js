"use strict";

/**
 * avito.classifier.js — deterministic message classifier.
 *
 * Runs synchronously (no LLM) so it never blocks the queue processor.
 * Returns structured classification for the router to act on.
 */

// ── Rule tables ───────────────────────────────────────────────────────────────

const INTENT_RULES = [
  {
    intent:   "complaint",
    patterns: [
      /брак|сломан|неисправен|не работает|дефект|сломался|поломка|возврат|обман|мошенник|плохое качество|разочарован|жалоб/,
    ],
  },
  {
    intent:   "price_inquiry",
    patterns: [
      /цена|сколько стоит|стоимость|почём|прайс|за сколько|ценник|дорого|дёшево|скидк|торг/,
    ],
  },
  {
    intent:   "availability",
    patterns: [
      /есть в наличии|в наличии|наличие|есть ли|доступно|осталось|последн|под заказ/,
    ],
  },
  {
    intent:   "delivery",
    patterns: [
      /доставка|доставить|привезти|самовывоз|курьер|почта|cdek|сдэк|пикап|транспортн/,
    ],
  },
  {
    intent:   "payment",
    patterns: [
      /оплата|оплатить|перевод|карта|нал|безнал|онлайн оплат|qr|куп/,
    ],
  },
  {
    intent:   "product_question",
    patterns: [
      /расскажи|опиши|характеристик|как работает|из чего|материал|размер|вес|модель|гарантия/,
    ],
  },
  {
    intent:   "greeting",
    patterns: [
      /^(привет|здравствуй|добрый|хай|хэй|hello|hi\b|доброе|добрый день|добрый вечер|доброе утро)/,
    ],
  },
  {
    intent:   "request_human",
    patterns: [
      /позовите|переключ|живой человек|оператор|менеджер|с человеком|не бот/,
    ],
  },
];

const HIGH_PRIORITY_INTENTS  = new Set(["complaint", "price_inquiry", "availability"]);
const HUMAN_REQUIRED_INTENTS = new Set(["complaint", "request_human"]);
const HOT_LEAD_INTENTS       = new Set(["price_inquiry", "availability", "payment"]);

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Classify an incoming Avito message.
 *
 * @param {string} text
 * @returns {{
 *   intent:        string,
 *   priority:      "high" | "medium" | "low",
 *   requiresHuman: boolean,
 *   isHotLead:     boolean,
 *   confidence:    number,
 * }}
 */
function classifyMessage(text) {
  const lower = (text || "").toLowerCase().trim();

  let matchedIntent     = "general";
  let matchedConfidence = 0.5;

  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) {
        matchedIntent     = rule.intent;
        matchedConfidence = 0.88;
        break;
      }
    }
    if (matchedIntent !== "general") break;
  }

  // Escalate confidence for very short greetings (high certainty)
  if (matchedIntent === "greeting" && lower.length < 20) {
    matchedConfidence = 0.95;
  }

  const priority      = HIGH_PRIORITY_INTENTS.has(matchedIntent)  ? "high"
                      : matchedIntent === "greeting"               ? "low"
                      : "medium";

  const requiresHuman = HUMAN_REQUIRED_INTENTS.has(matchedIntent);
  const isHotLead     = HOT_LEAD_INTENTS.has(matchedIntent);

  const result = {
    intent:        matchedIntent,
    priority,
    requiresHuman,
    isHotLead,
    confidence:    matchedConfidence,
  };

  process.stdout.write(
    `[avito:classifier] intent=${result.intent} priority=${result.priority} ` +
    `hotLead=${result.isHotLead} human=${result.requiresHuman} conf=${result.confidence}\n`
  );

  return result;
}

module.exports = { classifyMessage };
