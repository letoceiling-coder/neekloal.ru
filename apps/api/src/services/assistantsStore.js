"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "assistants.json");

/**
 * @returns {Array<{ id: string, name: string, model: string, systemPrompt: string, userId: string }>}
 */
function readAll() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

/**
 * @param {Array<{ id: string, name: string, model: string, systemPrompt: string, userId: string }>} list
 */
function writeAll(list) {
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/**
 * @param {string} id
 */
function findById(id) {
  return readAll().find((a) => a.id === id);
}

/**
 * @param {string} userId
 */
function listByUserId(userId) {
  return readAll().filter((a) => a.userId === userId);
}

/**
 * @param {{ id: string, name: string, model: string, systemPrompt: string, userId: string }} assistant
 */
function append(assistant) {
  const list = readAll();
  list.push(assistant);
  writeAll(list);
}

module.exports = { readAll, writeAll, findById, listByUserId, append };
