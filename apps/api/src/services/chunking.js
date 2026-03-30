"use strict";

/**
 * Carry last 1–2 sentences into the next chunk (sentence overlap).
 * @param {string} str
 * @param {number} maxSentences 1 or 2
 * @param {number} maxCharsBudget soft cap so overlap does not dominate the next chunk
 */
function takeLastSentencesForOverlap(str, maxSentences, maxCharsBudget) {
  const t = String(str ?? "").trim();
  if (!t) return "";
  const sents = splitIntoSentences(t);
  if (sents.length === 0) return t;
  const ms = Math.min(Math.max(1, maxSentences), 2);
  let n = Math.min(ms, sents.length);
  let joined = sents.slice(-n).join(" ");
  while (joined.length > maxCharsBudget && n > 1) {
    n -= 1;
    joined = sents.slice(-n).join(" ");
  }
  if (joined.length > maxCharsBudget) {
    return sents[sents.length - 1].trim();
  }
  return joined.trim();
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
 * Fixed-size windows (fallback for very long “sentences”).
 * @param {string} s
 * @param {number} maxChars
 * @param {number} overlapChars
 * @returns {string[]}
 */
function charChunks(s, maxChars, overlapChars) {
  const t = String(s);
  const out = [];
  let start = 0;
  while (start < t.length) {
    const end = Math.min(start + maxChars, t.length);
    out.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(0, end - overlapChars);
  }
  return out;
}

/**
 * Sentence-aware chunks: merge up to maxChars; overlap = last 1–2 sentences into next chunk.
 * @param {string} text
 * @param {{ maxChars?: number; overlapSentences?: number; overlapChars?: number }} [opts]
 * @returns {string[]}
 */
function chunkText(text, opts = {}) {
  const maxChars = opts.maxChars ?? (parseInt(process.env.RAG_CHUNK_MAX_CHARS || "900", 10) || 900);
  const overlapSentences =
    opts.overlapSentences ?? (parseInt(process.env.RAG_OVERLAP_SENTENCES || "2", 10) || 2);
  const overlapChars = opts.overlapChars ?? (parseInt(process.env.RAG_CHUNK_OVERLAP || "120", 10) || 120);

  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences = splitIntoSentences(normalized);
  const chunks = [];
  let buf = "";

  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) {
        chunks.push(buf);
        buf = takeLastSentencesForOverlap(buf, overlapSentences, maxChars);
      }
      const parts = charChunks(s, maxChars, overlapChars);
      for (const p of parts) {
        chunks.push(p);
      }
      buf = takeLastSentencesForOverlap(parts[parts.length - 1], overlapSentences, maxChars);
      continue;
    }

    const candidate = buf ? `${buf} ${s}` : s;
    if (candidate.length <= maxChars) {
      buf = candidate;
      continue;
    }

    if (buf) {
      chunks.push(buf);
      const carry = takeLastSentencesForOverlap(buf, overlapSentences, maxChars);
      buf = carry ? `${carry} ${s}`.trim() : s;
    } else {
      buf = s;
    }

    while (buf.length > maxChars) {
      const pushed = buf.slice(0, maxChars);
      chunks.push(pushed);
      const rest = buf.slice(maxChars);
      const carry = takeLastSentencesForOverlap(pushed, overlapSentences, maxChars);
      buf = carry ? `${carry} ${rest}`.trim() : rest;
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
  takeLastSentencesForOverlap,
};
