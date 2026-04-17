"use strict";
/**
 * Register Avito Messenger v3 webhook for a CRM agent (uses linked AvitoAccount token).
 * Usage: cd apps/api && node scripts/avito-register-webhook-for-agent.js <agentUuid>
 */
require("dotenv").config();
const prisma = require("../src/lib/prisma");
const { resolveAccountCredentials } = require("../src/modules/avito/avito.credentials");
const {
  registerMessengerV3Webhook,
  listMessengerWebhookSubscriptions,
} = require("../src/services/avitoClient");

const agentId = String(process.argv[2] ?? "").trim();
const base = String(
  process.env.AVITO_INCOMING_WEBHOOK_BASE ||
    process.env.PUBLIC_WEBHOOK_BASE ||
    "https://site-al.ru/api/incoming"
).replace(/\/$/, "");

(async () => {
  if (!agentId) {
    console.error("Usage: node scripts/avito-register-webhook-for-agent.js <agentUuid>");
    process.exit(1);
  }
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, deletedAt: null },
    include: { avitoAccount: true },
  });
  if (!agent) {
    console.log(JSON.stringify({ ok: false, error: "agent_not_found", agentId }, null, 2));
    process.exit(1);
  }
  if (!agent.avitoAccount) {
    console.log(
      JSON.stringify({ ok: false, error: "agent_has_no_avito_account", agentId }, null, 2)
    );
    process.exit(1);
  }
  const acc = agent.avitoAccount;
  if (!acc.isActive) {
    console.log(JSON.stringify({ ok: false, error: "avito_account_inactive", agentId }, null, 2));
    process.exit(1);
  }

  const webhookUrl = `${base}/${agentId}`;
  const { accessToken } = await resolveAccountCredentials(acc);
  const reg = await registerMessengerV3Webhook(accessToken, { url: webhookUrl });
  let subscriptions = null;
  try {
    subscriptions = await listMessengerWebhookSubscriptions(accessToken);
  } catch (e) {
    subscriptions = { error: String(e && e.message ? e.message : e) };
  }
  console.log(
    JSON.stringify(
      { ok: true, agentId, webhookUrl, register: reg, subscriptions },
      null,
      2
    )
  );
})()
  .catch((e) => {
    console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }, null, 2));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
