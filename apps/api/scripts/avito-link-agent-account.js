"use strict";
/**
 * Link an Agent to an AvitoAccount row (same organization).
 * Usage: cd apps/api && node scripts/avito-link-agent-account.js <agentUuid> <avitoAccountUuid>
 */
require("dotenv").config();
const prisma = require("../src/lib/prisma");

const agentId = String(process.argv[2] ?? "").trim();
const avitoAccountId = String(process.argv[3] ?? "").trim();

(async () => {
  if (!agentId || !avitoAccountId) {
    console.error(
      "Usage: node scripts/avito-link-agent-account.js <agentUuid> <avitoAccountUuid>"
    );
    process.exit(1);
  }
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, deletedAt: null },
    select: { id: true, organizationId: true },
  });
  if (!agent) {
    console.log(JSON.stringify({ ok: false, error: "agent_not_found" }, null, 2));
    process.exit(1);
  }
  const acc = await prisma.avitoAccount.findFirst({
    where: { id: avitoAccountId, organizationId: agent.organizationId },
  });
  if (!acc) {
    console.log(JSON.stringify({ ok: false, error: "avito_account_not_in_org" }, null, 2));
    process.exit(1);
  }
  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: { avitoAccountId },
    select: { id: true, name: true, avitoAccountId: true },
  });
  console.log(JSON.stringify({ ok: true, agent: updated }, null, 2));
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
