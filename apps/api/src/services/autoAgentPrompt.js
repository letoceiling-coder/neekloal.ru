"use strict";

/**
 * Builds the LLM prompt for auto-agent config generation.
 * Output must be strict JSON — no markdown, no prose.
 * @param {string} description  User's business description
 * @returns {string}
 */
function buildAutoAgentPrompt(description) {
  return (
    "Ты — AI архитектор продаж. Твоя задача: создать конфигурацию AI ассистента.\n" +
    "Отвечай СТРОГО в формате JSON — без markdown, без объяснений, только объект.\n\n" +
    "Бизнес клиента:\n" +
    description.trim() +
    "\n\n" +
    "Сгенерируй JSON строго по этой схеме:\n" +
    "{\n" +
    '  "systemPrompt": "краткий системный промпт (2-4 предложения) для этого бизнеса, на русском",\n' +
    '  "config": {\n' +
    '    "intents": {\n' +
    '      "pricing": ["список ключевых слов для запроса цены/стоимости"],\n' +
    '      "objection": ["список слов — возражения, дорого, не уверен"],\n' +
    '      "qualification": ["слова — интерес к покупке, вопросы о продукте"],\n' +
    '      "close": ["слова — готовность купить, оформить, договориться"]\n' +
    '    },\n' +
    '    "memory": ["budget", "projectType", "timeline"],\n' +
    '    "funnel": ["greeting", "qualification", "offer", "objection", "close"],\n' +
    '    "validation": { "maxSentences": 3, "questions": 1 }\n' +
    '  }\n' +
    "}\n\n" +
    "Правила:\n" +
    "— intents должны отражать специфику этого бизнеса (на русском)\n" +
    "— systemPrompt коротко, без абстракций, под роль менеджера продаж\n" +
    "— только JSON, никакого текста до или после\n"
  );
}

/**
 * Builds the LLM prompt to REFINE an existing config.
 * @param {Record<string,unknown>} config   Current assistant config
 * @param {string} systemPrompt             Current system prompt
 * @param {string} instruction              What to change ("сделай агрессивнее")
 * @returns {string}
 */
function buildRefinePrompt(config, systemPrompt, instruction) {
  return (
    "Ты — AI архитектор продаж. Улучши конфигурацию AI ассистента согласно инструкции.\n" +
    "Отвечай СТРОГО в формате JSON — без markdown, без объяснений, только объект.\n\n" +
    "Текущий systemPrompt:\n" +
    String(systemPrompt ?? "").trim() +
    "\n\nТекущий config (JSON):\n" +
    JSON.stringify(config ?? {}, null, 2) +
    "\n\nИнструкция для улучшения:\n" +
    String(instruction ?? "").trim() +
    "\n\n" +
    "Верни улучшенный JSON строго по этой схеме:\n" +
    "{\n" +
    '  "systemPrompt": "...",\n' +
    '  "config": {\n' +
    '    "intents": { ... },\n' +
    '    "memory": [...],\n' +
    '    "funnel": [...],\n' +
    '    "validation": { "maxSentences": 3, "questions": 1 }\n' +
    '  }\n' +
    "}\n\n" +
    "Только JSON, никакого текста до или после.\n"
  );
}

module.exports = { buildAutoAgentPrompt, buildRefinePrompt };
