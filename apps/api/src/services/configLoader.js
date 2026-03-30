"use strict";

const defaultConfig = require("../config/defaultAssistantConfig");

/**
 * Merges assistant.config (DB JSON) with defaultConfig.
 * - If assistant.config is null/undefined → return defaultConfig as-is.
 * - Otherwise deep-merge: assistant.config values override defaults.
 *   Top-level keys only — nested objects are replaced, not merged.
 *
 * @param {{ config?: object | null }} assistant
 * @returns {typeof defaultConfig}
 */
function getAssistantConfig(assistant) {
  const override =
    assistant &&
    assistant.config &&
    typeof assistant.config === "object" &&
    !Array.isArray(assistant.config)
      ? assistant.config
      : null;

  if (!override) {
    return defaultConfig;
  }

  const merged = { ...defaultConfig, ...override };
  console.log("[configLoader] CONFIG USED:", JSON.stringify(merged).slice(0, 120) + "…");
  return merged;
}

module.exports = { getAssistantConfig };
