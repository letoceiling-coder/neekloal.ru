"use strict";

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PLANS = [
  {
    slug: "free",
    name: "Free",
    maxRequestsPerMonth: 100,
    maxTokensPerMonth: 50_000,
    allowedModels: ["*"],
  },
  {
    slug: "pro",
    name: "Pro",
    maxRequestsPerMonth: 5000,
    maxTokensPerMonth: 2_000_000,
    allowedModels: ["*"],
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    maxRequestsPerMonth: null,
    maxTokensPerMonth: null,
    allowedModels: ["*"],
  },
];

async function main() {
  for (const p of PLANS) {
    const existing = await prisma.plan.findFirst({
      where: { slug: p.slug, deletedAt: null },
    });
    if (!existing) {
      await prisma.plan.create({ data: p });
    } else {
      await prisma.plan.update({
        where: { id: existing.id },
        data: {
          name: p.name,
          maxRequestsPerMonth: p.maxRequestsPerMonth,
          maxTokensPerMonth: p.maxTokensPerMonth,
          allowedModels: p.allowedModels,
        },
      });
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
