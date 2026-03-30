"use strict";

/**
 * Extracts structured memory fields from a user message using config.memory.
 *
 * Each field name maps to a built-in extractor. New fields can be added here
 * without touching hybridSales.js.
 *
 * @param {unknown} message   Raw user message
 * @param {string}  intent    Detected intent (for projectType inference)
 * @param {{ memory?: string[] } | null} config  Assistant config
 * @returns {Record<string, unknown>}  Extracted key-value pairs (empty if nothing found)
 */
function extractMemory(message, intent, config) {
  const fields = Array.isArray(config?.memory) ? config.memory : null;
  const t = String(message ?? "").toLowerCase();
  const result = {};

  // ── budget ──────────────────────────────────────────────────────────────────
  function extractBudget() {
    if (!t.includes("бюджет")) return null;
    const m = t.match(/бюджет[^0-9]{0,30}([0-9][0-9\s]{2,})(?:\s*(?:руб|р\.|₽))?/i);
    if (!m?.[1]) return null;
    const n = parseInt(String(m[1]).replace(/\s+/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  }

  // ── projectType ──────────────────────────────────────────────────────────────
  function extractProjectType() {
    if (
      intent !== "qualification_site" &&
      !t.includes("сайт") &&
      !t.includes("лендинг") &&
      !t.includes("интернет-магазин")
    ) return null;

    if (t.includes("интернет-магазин") || t.includes("интернет магазин")) return "ecommerce";
    if (t.includes("лендинг")) return "landing";
    if (t.includes("сайт") || t.includes("проект") || t.includes("разработк")) return "website";
    return null;
  }

  // ── timeline ──────────────────────────────────────────────────────────────────
  function extractTimeline() {
    if (t.includes("срочно") || t.includes("как можно скорее") || t.includes("asap")) return "urgent";
    if (t.includes("не спеш") || t.includes("когда будет время")) return "flexible";
    return null;
  }

  // ── contactName ────────────────────────────────────────────────────────────
  function extractContactName() {
    const m = t.match(/(?:меня зовут|я\s+[-]?\s*)([а-яёa-z]{2,20})/i);
    return m?.[1] ? m[1].trim() : null;
  }

  // ── phone ──────────────────────────────────────────────────────────────────
  function extractPhone() {
    const m = t.match(/(?:\+7|8)?[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
    return m ? m[0].replace(/\s/g, "") : null;
  }

  // ── Dispatch: if config.memory is provided → only extract listed fields ─────
  const extractors = { budget: extractBudget, projectType: extractProjectType, timeline: extractTimeline, contactName: extractContactName, phone: extractPhone };

  const activeFields = fields ?? Object.keys(extractors);

  for (const field of activeFields) {
    const fn = extractors[field];
    if (!fn) continue;
    const val = fn();
    if (val != null) result[field] = val;
  }

  return result;
}

module.exports = { extractMemory };
