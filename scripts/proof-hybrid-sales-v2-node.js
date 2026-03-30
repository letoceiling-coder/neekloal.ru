/* eslint-disable no-console */
"use strict";

const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

async function main() {
  const API = "https://site-al.ru/api";

  const prisma = new PrismaClient();
  const m = await prisma.membership.findFirst({
    where: { deletedAt: null },
    select: { organizationId: true, userId: true },
  });
  if (!m) throw new Error("no membership");

  const assistant = await prisma.assistant.findFirst({
    where: { organizationId: m.organizationId, deletedAt: null },
    select: { id: true },
  });
  if (!assistant) throw new Error("no assistant");

  const token = jwt.sign(
    { userId: m.userId, organizationId: m.organizationId },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  // Create conversation directly via Prisma (so we control the conversationId)
  const conv = await prisma.conversation.create({
    data: {
      organizationId: m.organizationId,
      assistantId: assistant.id,
      status: "OPEN",
      source: "DASHBOARD",
      createdByUserId: m.userId,
    },
    select: { id: true, assistantId: true, salesStage: true, context: true },
  });

  console.log("assistantId:", assistant.id);
  console.log("conversationId:", conv.id);

  // 1) Chat with budget + landing (memory update)
  const chat1 = await fetch(`${API}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: assistant.id,
      conversationId: conv.id,
      message: "У нас бюджет 30000. Хочу лендинг.",
    }),
  });
  const chat1Json = await chat1.json().catch(() => ({}));
  console.log("chat1 reply (trunc):", String(chat1Json?.reply ?? "").slice(0, 120));

  const convAfter1 = await prisma.conversation.findFirst({
    where: { id: conv.id },
    select: { salesStage: true, context: true },
  });

  console.log("DB after chat1 salesStage:", convAfter1?.salesStage);
  console.log("DB after chat1 context:", JSON.stringify(convAfter1?.context ?? null));

  // 2) Create pricing knowledge (knowledge.intent)
  const know = await fetch(`${API}/knowledge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: assistant.id,
      content: "Цена 12345 руб. Пакет включает консультацию и сопровождение.",
    }),
  });
  const knowJson = await know.json().catch(() => ({}));
  console.log("knowledge creation status:", know.status);
  console.log("knowledgeId:", knowJson?.id);

  // 3) Ask pricing again (should route via knowledge.intent -> include 12345)
  const chat2 = await fetch(`${API}/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistantId: assistant.id,
      conversationId: conv.id,
      message: "сколько стоит",
    }),
  });
  const chat2Json = await chat2.json().catch(() => ({}));
  const reply2 = String(chat2Json?.reply ?? "");
  console.log("chat2 reply (trunc):", reply2.slice(0, 180));
  console.log("reply2 includes 12345?:", reply2.includes("12345"));

  const convAfter2 = await prisma.conversation.findFirst({
    where: { id: conv.id },
    select: { salesStage: true, context: true },
  });
  console.log("DB after chat2 salesStage:", convAfter2?.salesStage);
  console.log("DB after chat2 context:", JSON.stringify(convAfter2?.context ?? null));

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });

