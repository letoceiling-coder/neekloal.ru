"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "users.json");

/**
 * @returns {Array<{ id: string, email: string }>}
 */
function readAll() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {Array<{ id: string, email: string }>} list
 */
function writeAll(list) {
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/**
 * @param {string} id
 * @returns {{ id: string, email: string } | undefined}
 */
function findById(id) {
  return readAll().find((u) => u.id === id);
}

/**
 * @param {{ id: string, email: string }} user
 */
function append(user) {
  const list = readAll();
  list.push(user);
  writeAll(list);
}

module.exports = { readAll, writeAll, findById, append };
