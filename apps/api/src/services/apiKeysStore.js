"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "apiKeys.json");

/**
 * @returns {Array<{ key: string, userId: string }>}
 */
function readAll() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {Array<{ key: string, userId: string }>} list
 */
function writeAll(list) {
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/**
 * @param {string} key
 * @returns {{ key: string, userId: string } | undefined}
 */
function findByKey(key) {
  return readAll().find((r) => r.key === key);
}

/**
 * @param {{ key: string, userId: string }} row
 */
function append(row) {
  const list = readAll();
  list.push(row);
  writeAll(list);
}

module.exports = { readAll, writeAll, findByKey, append };
