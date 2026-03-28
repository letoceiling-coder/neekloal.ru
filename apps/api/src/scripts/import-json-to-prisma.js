"use strict";

/**
 * One-time import from legacy src/data/*.json into PostgreSQL.
 * Run from apps/api: node src/scripts/import-json-to-prisma.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const prisma = require("../lib/prisma");
const { hashApiKey } = require("../lib/apiKeyHash");

const DATA = path.join(__dirname, "..", "data");

function readJson(name) {
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  for (const u of readJson("users.json")) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: { id: u.id, email: u.email },
      update: { email: u.email },
    });
    console.log("user", u.id);
  }

  for (const row of readJson("apiKeys.json")) {
    const keyHash = hashApiKey(row.key);
    const existing = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!existing) {
      await prisma.apiKey.create({
        data: { keyHash, userId: row.userId },
      });
      console.log("apiKey hash imported for user", row.userId);
    }
  }

  for (const a of readJson("assistants.json")) {
    await prisma.assistant.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        userId: a.userId,
        name: a.name,
        model: a.model,
        systemPrompt: a.systemPrompt,
      },
      update: {
        name: a.name,
        model: a.model,
        systemPrompt: a.systemPrompt,
      },
    });
    console.log("assistant", a.id);
  }

  for (const k of readJson("knowledge.json")) {
    await prisma.knowledge.upsert({
      where: { id: k.id },
      create: {
        id: k.id,
        assistantId: k.assistantId,
        type: "text",
        content: k.content,
      },
      update: { content: k.content },
    });
    console.log("knowledge", k.id);
  }

  for (const r of readJson("usage.json")) {
    await prisma.usage.create({
      data: {
        userId: r.userId,
        model: r.model,
        tokens: r.tokens,
        createdAt: new Date(r.timestamp),
      },
    });
    console.log("usage row");
  }

  for (const r of readJson("rateLimit.json")) {
    const keyHash = hashApiKey(r.apiKey);
    await prisma.rateLimitState.upsert({
      where: { keyHash },
      create: {
        keyHash,
        count: r.count,
        resetAt: new Date(r.resetAt),
      },
      update: {
        count: r.count,
        resetAt: new Date(r.resetAt),
      },
    });
    console.log("rateLimit", keyHash.slice(0, 8));
  }

  console.log("IMPORT DONE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
