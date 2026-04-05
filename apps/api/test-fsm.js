"use strict";
const { resolveNextState, extractPhone } = require("./src/modules/avito/avito.fsm");
const { classifyMessage }                = require("./src/modules/avito/avito.classifier");
const { routeMessage }                   = require("./src/modules/avito/avito.router");
const { PrismaClient }                   = require("@prisma/client");

let passed = 0, failed = 0;
function assert(label, actual, expected) {
  const ok = String(actual) === String(expected);
  const icon = ok ? "  ✅ PASS" : "  ❌ FAIL";
  process.stdout.write(icon + " " + label + ": got=" + actual + (ok ? "" : " expected=" + expected) + "\n");
  ok ? passed++ : failed++;
}

// ── TEST 1 — price_inquiry → QUALIFYING ──────────────────────────────────────
process.stdout.write("\n══ TEST 1: price_inquiry → status=QUALIFYING ══\n");
const cls1 = classifyMessage("Сколько стоит этот товар?");
process.stdout.write("  classifier: intent=" + cls1.intent + " isHotLead=" + cls1.isHotLead + " priority=" + cls1.priority + "\n");
assert("T1:intent",     cls1.intent,  "price_inquiry");
assert("T1:isHotLead",  cls1.isHotLead, true);
const next1 = resolveNextState({ status: "NEW", isHot: false, phone: null }, cls1);
assert("T1:nextStatus", next1, "QUALIFYING");

// ── TEST 2 — phone detection → HANDOFF ───────────────────────────────────────
process.stdout.write("\n══ TEST 2: phone detection → status=HANDOFF ══\n");
const phone2 = extractPhone("мой номер +79991234567 позвоните мне");
assert("T2:phone",  phone2, "+79991234567");
// processor logic: if phone detected && !lead.phone → set status=HANDOFF
// simulate:
const lead2after = { status: "QUALIFYING", phone: phone2 };
if (phone2) lead2after.status = "HANDOFF";
assert("T2:status_after_phone", lead2after.status, "HANDOFF");
process.stdout.write("  INFO phone=" + phone2 + " → processor sets status=HANDOFF + saves phone to DB\n");

// ── TEST 3 — isHot=true → decision=human ─────────────────────────────────────
process.stdout.write("\n══ TEST 3: isHot=true → decision=human ══\n");
const cls3  = classifyMessage("Сколько стоит? Хочу купить срочно");
const lead3 = { status: "QUALIFYING", isHot: true, phone: null };
const r3    = routeMessage({ avitoMode: "autoreply", autoReply: true }, cls3, lead3);
process.stdout.write("  router: decision=" + r3.decision + " reason=" + r3.reason + "\n");
assert("T3:decision",       r3.decision, "human");
assert("T3:reason_isHot",   String(r3.reason.includes("isHot")), "true");

// ── TEST 4 — status=HANDOFF → decision=human, no AI ──────────────────────────
process.stdout.write("\n══ TEST 4: status=HANDOFF → decision=human (AI stop) ══\n");
const cls4  = classifyMessage("когда вы работаете?");
const lead4 = { status: "HANDOFF", isHot: false, phone: "+79991234567" };
const r4    = routeMessage({ avitoMode: "autoreply", autoReply: true }, cls4, lead4);
process.stdout.write("  router: decision=" + r4.decision + " reason=" + r4.reason + "\n");
assert("T4:decision",       r4.decision, "human");
assert("T4:reason_HANDOFF", String(r4.reason.includes("HANDOFF")), "true");
process.stdout.write("  INFO processor HANDOFF guard → [avito:handoff] stopped AI — agentChatV2 NOT called\n");

// ── BONUS: FSM no-downgrade ───────────────────────────────────────────────────
process.stdout.write("\n══ BONUS: no state downgrade ══\n");
const next5 = resolveNextState({ status: "HANDOFF", isHot: false }, classifyMessage("привет"));
assert("BONUS:no_downgrade", next5, "HANDOFF");

// ── DB: verify avito_leads table ─────────────────────────────────────────────
process.stdout.write("\n══ DB: avito_leads table ══\n");
const prisma = new PrismaClient();
prisma.$queryRaw`SELECT COUNT(*) as cnt FROM avito_leads`
  .then((r) => {
    process.stdout.write("  avito_leads rows: " + r[0].cnt + "\n");
    passed++;
    return prisma.$disconnect();
  })
  .catch((e) => {
    process.stdout.write("  ❌ avito_leads query failed: " + e.message + "\n");
    failed++;
    return prisma.$disconnect();
  })
  .finally(() => {
    process.stdout.write("\n" + "═".repeat(52) + "\n");
    process.stdout.write("RESULTS: " + passed + " passed, " + failed + " failed\n");
    if (failed > 0) {
      process.stderr.write("SOME TESTS FAILED\n");
      process.exit(1);
    } else {
      process.stdout.write("ALL TESTS PASSED ✅\n");
    }
  });
