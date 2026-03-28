"use strict";

/**
 * Character-based chunks with overlap (simple, language-agnostic).
 * @param {string} text
 * @param {{ maxChars?: number; overlap?: number }} [opts]
 * @returns {string[]}
 */
function chunkText(text, opts = {}) {
  const maxChars = opts.maxChars ?? (parseInt(process.env.RAG_CHUNK_MAX_CHARS || "900", 10) || 900);
  const overlap = opts.overlap ?? (parseInt(process.env.RAG_CHUNK_OVERLAP || "120", 10) || 120);

  const t = String(text ?? "").trim();
  if (!t) {
    return [];
  }

  const chunks = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + maxChars, t.length);
    chunks.push(t.slice(start, end));
    if (end >= t.length) {
      break;
    }
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

module.exports = {
  chunkText,
};
