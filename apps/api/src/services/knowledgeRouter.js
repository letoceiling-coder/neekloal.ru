"use strict";

const prisma = require("../lib/prisma");

/** @type {Record<string, string[]>} */
const SOURCE_HINTS = {
  pricing: ["pricing", "price", "цена", "тариф", "прайс", "стоим"],
  objection: ["objection", "возраж", "дорого", "отработк"],
  qualification_site: ["qualification", "сайт", "site", "проект", "бриф"],
};

/**
 * Подобрать фрагменты базы знаний под intent.
 * Приоритет:
 *  1) knowledge.intent
 *  2) sourceName/content подсказки (для обратной совместимости)
 * @param {string} assistantId
 * @param {string} organizationId
 * @param {string} intent — pricing | objection | qualification_site | …
 * @returns {Promise<string>} — склеенный текст или ""
 */
async function routeKnowledgeByIntent(assistantId, organizationId, intent) {
  if (!intent || intent === "unknown" || intent === "close") {
    return "";
  }

  const hints = SOURCE_HINTS[intent];
  if (!hints) {
    return "";
  }

  const rows = await prisma.knowledge.findMany({
    where: {
      assistantId,
      organizationId,
      deletedAt: null,
    },
    select: { intent: true, sourceName: true, content: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const matched = [];
  for (const row of rows) {
    const name = String(row.sourceName ?? "").toLowerCase();
    const content = String(row.content ?? "");
    const tagged = row.intent != null ? String(row.intent).toLowerCase() : "";

    let hit = false;
    if (tagged && tagged === intent.toLowerCase()) {
      hit = true;
    }
    if (!hit && !tagged) {
      for (const h of hints) {
        if (name.includes(h)) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      matched.push(content.trim());
    }
  }

  if (matched.length === 0) {
    return "";
  }

  return matched.join("\n\n---\n\n").slice(0, 12000);
}

module.exports = { routeKnowledgeByIntent, SOURCE_HINTS };
