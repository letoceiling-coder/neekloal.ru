"use strict";

/**
 * Last `overlap` chars of `str`, trimmed to start after the last space in that window
 * so the next chunk does not begin mid-word.
 * @param {string} str
 * @param {number} overlap
 */
function takeOverlapTail(str, overlap) {
  if (!str || overlap <= 0) return "";
  const t = String(str);
  if (t.length <= overlap) return t.trim();
  const start = Math.max(0, t.length - overlap);
  const window = t.slice(start);
  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) {
    return t.slice(start + lastSpace + 1).trimStart();
  }
  return window.trimStart();
}

/**
 * Split on sentence boundaries (. ? !) after optional whitespace.
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [t];
  return parts;
}

/**
 * Fixed-size windows with overlap (fallback for very long “sentences”).
 * @param {string} s
 * @param {number} maxChars
 * @param {number} overlap
 * @returns {string[]}
 */
function charChunks(s, maxChars, overlap) {
  const t = String(s);
  const out = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + maxChars, t.length);
    out.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(0, end - overlap);
  }
  return out;
}

/**
 * Sentence-aware chunks: split by . ? !, merge up to maxChars, overlap between chunks.
 * @param {string} text
 * @param {{ maxChars?: number; overlap?: number }} [opts]
 * @returns {string[]}
 */
function chunkText(text, opts = {}) {
  const maxChars = opts.maxChars ?? (parseInt(process.env.RAG_CHUNK_MAX_CHARS || "900", 10) || 900);
  const overlap = opts.overlap ?? (parseInt(process.env.RAG_CHUNK_OVERLAP || "120", 10) || 120);

  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = splitIntoSentences(normalized);
  const chunks = [];
  let buf = "";

  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      const parts = charChunks(s, maxChars, overlap);
      for (const p of parts) {
        chunks.push(p);
      }
      buf = takeOverlapTail(parts[parts.length - 1], overlap);
      continue;
    }

    const candidate = buf ? `${buf} ${s}` : s;
    if (candidate.length <= maxChars) {
      buf = candidate;
    } else {
      if (buf) {
        chunks.push(buf);
        const tail = takeOverlapTail(buf, overlap);
        buf = tail ? `${tail} ${s}`.trim() : s;
      } else {
        buf = s;
      }
      while (buf.length > maxChars) {
        chunks.push(buf.slice(0, maxChars));
        buf = buf.slice(Math.max(0, maxChars - overlap));
      }
    }
  }

  if (buf) {
    chunks.push(buf);
  }

  return chunks;
}

module.exports = {
  chunkText,
  splitIntoSentences,
};
