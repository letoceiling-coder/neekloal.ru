"use strict";
/**
 * One-off: inspect org/agents/Avito for a user email (no secrets in stdout).
 * Usage: cd apps/api && node scripts/avito-inspect-user.js dsc-23@yandex.ru
 */
require("dotenv").config();
const prisma = require("../src/lib/prisma");

const email = String(process.argv[2] ?? "").trim() || "dsc-23@yandex.ru";

(async () => {
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  if (!user) {
    console.log(JSON.stringify({ error: "user_not_found", email }, null, 2));
    return;
  }
  const mem = await prisma.membership.findFirst({
    where: { userId: user.id, deletedAt: null },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
  if (!mem) {
    console.log(JSON.stringify({ error: "no_membership", userId: user.id }, null, 2));
    return;
  }
  const orgId = mem.organizationId;
  const agents = await prisma.agent.findMany({
    where: { organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, avitoMode: true, avitoAccountId: true },
    orderBy: { createdAt: "asc" },
  });
  const accounts = await prisma.avitoAccount.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      accountId: true,
      isActive: true,
      clientId: true,
      webhookSecret: true,
      accessToken: true,
      accessTokenExpiresAt: true,
    },
  });
  const safeAcc = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    accountId: a.accountId,
    isActive: a.isActive,
    hasClientId: Boolean(a.clientId && String(a.clientId).trim()),
    hasWebhookSecret: Boolean(a.webhookSecret && String(a.webhookSecret).trim()),
    hasAccessToken: Boolean(a.accessToken && String(a.accessToken).trim()),
    accessTokenExpiresAt: a.accessTokenExpiresAt,
  }));
  console.log(
    JSON.stringify(
      {
        userId: user.id,
        email: user.email,
        organizationId: orgId,
        organization: mem.organization,
        agents,
        avitoAccounts: safeAcc,
      },
      null,
      2
    )
  );
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
