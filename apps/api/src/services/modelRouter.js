"use strict";

/**
 * modelRouter.js — централизованный выбор LLM модели по задаче.
 *
 * Конфигурация через .env:
 *   ENHANCER_MODEL  — модель для улучшения промптов (default: qwen2.5:7b)
 *   BRAIN_MODEL     — модель для аналитических задач  (default: qwen2.5:7b)
 *   CHAT_MODEL      — модель для чата                 (default: llama3:8b)
 *   CODE_MODEL      — модель для кода                 (default: codellama:latest)
 *   FALLBACK_MODEL  — резервная модель                (default: llama3:8b)
 *
 * Добавление новой задачи: просто добавьте case ниже.
 */

const MODEL_MAP = {
  enhance:  process.env.ENHANCER_MODEL || "qwen2.5:7b",
  brain:    process.env.BRAIN_MODEL    || "qwen2.5:7b",
  chat:     process.env.CHAT_MODEL     || "llama3:8b",
  code:     process.env.CODE_MODEL     || "codellama:latest",
  embed:    process.env.EMBED_MODEL    || "nomic-embed-text:latest",
  fallback: process.env.FALLBACK_MODEL || "llama3:8b",
};

/**
 * Выбирает модель для задачи.
 * @param {"enhance"|"brain"|"chat"|"code"|"embed"|string} task
 * @returns {string} Название модели Ollama
 */
function selectModel(task) {
  const model = MODEL_MAP[task] ?? MODEL_MAP.fallback;
  return model;
}

/**
 * Возвращает все настроенные модели (для диагностики).
 */
function getAllModels() {
  return { ...MODEL_MAP };
}

/**
 * Returns list of available models.
 * Fetches from Ollama /api/tags; falls back to configured models on error.
 * @returns {Promise<string[]>}
 */
async function listAvailableModels() {
  const base = process.env.OLLAMA_URL;
  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const names = (data.models ?? []).map((m) => m.name).filter(Boolean);
        if (names.length > 0) return names;
      }
    } catch { /* fall through to configured list */ }
  }
  return [...new Set(Object.values(MODEL_MAP))];
}

module.exports = { selectModel, getAllModels, listAvailableModels };
