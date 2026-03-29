/**
 * Список моделей для админ-UI (планы, фильтр usage).
 * При появлении GET /admin/models можно подставить данные с API.
 */
export const KNOWN_AI_MODELS: readonly string[] = [
  "llama3",
  "llama3.2",
  "mistral",
  "mixtral",
  "gpt-4",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "claude-3-opus",
  "claude-3-sonnet",
  "gemini-pro",
] as const;
