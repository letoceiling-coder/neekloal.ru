"use strict";

const prisma = require("../lib/prisma");

/** @type {Record<string, string[]>} */
const SOURCE_HINTS = {
  pricing: ["pricing", "price", "цена", "тариф", "прайс", "стоим"],
  objection: ["objection", "возраж", "дорого", "отработк"],
  qualification_site: ["qualification", "сайт", "site", "проект", "бриф"],
};

const INTENT_LINE_RE = /^\s*(?:#+\s*)?(?:intent|интент)\s*[:：]\s*([a-z0-9_]+)\s*$/i;

/**
 * Подобрать фрагменты базы знаний под intent (по sourceName / первой строке контента).
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
    select: { sourceName: true, content: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  const matched = [];
  for (const row of rows) {
    const name = String(row.sourceName ?? "").toLowerCase();
    const content = String(row.content ?? "");
    const firstLine = content.split("\n")[0] ?? "";
    const lineIntent = firstLine.match(INTENT_LINE_RE);
    const tagged = lineIntent ? String(lineIntent[1]).toLowerCase() : "";

    let hit = false;
    if (tagged === intent.toLowerCase()) {
      hit = true;
    }
    if (!hit) {
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
