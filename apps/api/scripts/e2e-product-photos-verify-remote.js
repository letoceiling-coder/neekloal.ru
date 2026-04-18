"use strict";

/**
 * One-off E2E on production host (run from apps/api cwd, .env loaded):
 *   node scripts/e2e-product-photos-verify-remote.js
 * Creates a temporary API key, calls POST /api/v1/product-photos/verify, deletes the key.
 */
require("dotenv").config();
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const prisma = require("../src/lib/prisma");
const { hashApiKey } = require("../src/lib/apiKeyHash");

(async () => {
  const org = await prisma.organization.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!org) {
    console.error("no org");
    process.exit(1);
  }
  const key = "sk-e2e-" + crypto.randomBytes(12).toString("hex");
  const row = await prisma.apiKey.create({
    data: {
      organizationId: org.id,
      keyHash: hashApiKey(key),
      name: "e2e-product-photos-verify-temp",
      allowedDomains: [],
    },
  });

  const payload = JSON.stringify({
    productName: "Кот",
    description: "фотография домашнего животного",
    color: null,
    photos: [
      {
        url: "https://placehold.co/600x400.jpg",
      },
    ],
    options: { minConfidence: 0.35, language: "ru", concurrency: 1 },
  });

  const r = spawnSync(
    "curl",
    [
      "-sS",
      "-w",
      "\nHTTP:%{http_code}\n",
      "-X",
      "POST",
      "https://site-al.ru/api/v1/product-photos/verify",
      "-H",
      "Content-Type: application/json",
      "-H",
      "X-Api-Key: " + key,
      "-d",
      payload,
      "--max-time",
      "180",
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }
  );
  console.log(r.stdout || r.stderr || String(r.error));

  await prisma.apiKey.delete({ where: { id: row.id } });
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
