"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "knowledge.json");

/**
 * @returns {Array<{ id: string, assistantId: string, content: string }>}
 */
function readAll() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {Array<{ id: string, assistantId: string, content: string }>} list
 */
function writeAll(list) {
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/**
 * @param {string} assistantId
 * @returns {Array<{ id: string, assistantId: string, content: string }>}
 */
function listByAssistantId(assistantId) {
  return readAll().filter((k) => k.assistantId === assistantId);
}

/**
 * @param {{ id: string, assistantId: string, content: string }} row
 */
function append(row) {
  const list = readAll();
  list.push(row);
  writeAll(list);
}

module.exports = { readAll, writeAll, listByAssistantId, append };
