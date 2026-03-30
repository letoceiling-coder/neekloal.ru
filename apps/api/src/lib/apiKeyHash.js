"use strict";

const crypto = require("crypto");

/**
 * SHA-256 hex of the raw API key (Bearer secret). Used for storage and lookups.
 * @param {string} rawKey
 * @returns {string}
 */
function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey), "utf8").digest("hex");
}

module.exports = { hashApiKey };
