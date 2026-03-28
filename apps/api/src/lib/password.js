"use strict";

const bcrypt = require("bcryptjs");

const ROUNDS = 12;

/**
 * @param {string} plain
 */
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), ROUNDS);
}

/**
 * @param {string} plain
 * @param {string} hash
 */
async function verifyPassword(plain, hash) {
  if (hash == null || String(hash).trim() === "") {
    return false;
  }
  return bcrypt.compare(String(plain), String(hash));
}

module.exports = {
  hashPassword,
  verifyPassword,
};
