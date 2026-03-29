"use strict";

/**
 * Нормализация телефона (РФ и общий международный вид).
 * @param {string} digits только цифры
 * @returns {string|null} например +79991234567
 */
function normalizePhoneDigits(digits) {
  let d = String(digits).replace(/\D/g, "");
  if (d.length < 10 || d.length > 15) {
    return null;
  }
  if (d.length === 11 && d[0] === "8") {
    d = "7" + d.slice(1);
  }
  if (d.length === 10) {
    d = "7" + d;
  }
  if (d.length === 11 && d[0] === "7") {
    return `+${d}`;
  }
  if (d.length >= 10 && d.length <= 15) {
    return `+${d}`;
  }
  return null;
}

/**
 * Вытащить телефон из текста пользователя.
 * @param {unknown} text
 * @returns {string|null}
 */
function extractPhoneFromText(text) {
  const s = String(text ?? "");
  if (!s.trim()) {
    return null;
  }

  const patterns = [
    /\+?\d[\d\s().-]{8,20}\d/g,
    /(?:\+7|8|7)[\s(]*\d{3}[\s)]*\d{3}[\s-]?\d{2}[\s-]?\d{2}/g,
    /\b\d{10,11}\b/g,
  ];

  const seen = new Set();
  for (const re of patterns) {
    const matches = s.match(re);
    if (!matches) {
      continue;
    }
    for (const raw of matches) {
      const norm = normalizePhoneDigits(raw);
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        return norm;
      }
    }
  }

  const allDigits = s.replace(/\D/g, "");
  if (allDigits.length >= 10 && allDigits.length <= 15) {
    return normalizePhoneDigits(allDigits);
  }
  return null;
}

/**
 * Телефон для лида: только цифры, длина 10–15. Иначе null (не сохранять).
 * Не перезаписывать существующий phone на стороне вызывающего кода.
 * @param {unknown} text
 * @returns {string|null}
 */
function getLeadPhoneDigitsFromText(text) {
  const normalized = extractPhoneFromText(text);
  if (!normalized) {
    return null;
  }
  const digits = String(normalized).replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

/**
 * Простое извлечение имени из фраз пользователя.
 * @param {unknown} text
 * @returns {string|null}
 */
function extractNameFromText(text) {
  const s = String(text ?? "").trim();
  if (s.length < 2 || s.length > 200) {
    return null;
  }

  const patterns = [
    /(?:меня зовут|мое имя|моё имя|имя[:\s]+)\s*([А-Яа-яЁёA-Za-z][А-Яа-яЁёA-Za-z\s-]{1,35})/i,
    /(?:я\s+)[—\-–]?\s*([А-Яа-яЁё][А-Яа-яЁёa-z-]{1,25})/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m && m[1]) {
      const name = m[1].trim().replace(/\s+/g, " ");
      if (name.length >= 2 && name.length <= 80) {
        return name;
      }
    }
  }
  return null;
}

module.exports = {
  extractPhoneFromText,
  extractNameFromText,
  normalizePhoneDigits,
  getLeadPhoneDigitsFromText,
};
