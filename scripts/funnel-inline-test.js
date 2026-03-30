"use strict";
// Standalone test — no Prisma/Redis imports
const computeNextStage = function(current, intent) {
  const VALID = new Set(["greeting","qualification","offer","objection","close"]);
  const c = VALID.has(current) ? current : "greeting";
  if (intent === "qualification_site") return "qualification";
  if (intent === "objection") return "objection";
  if (intent === "pricing") return "offer";
  if (intent === "close") return "close";
  return c;
};
const getNextStage = function(cur, intent, config) {
  const funnel = Array.isArray(config && config.funnel) && config.funnel.length > 0
    ? config.funnel : null;
  if (!funnel) return computeNextStage(cur, intent);
  const idx = funnel.indexOf(cur);
  if (idx === -1) return funnel[0];
  if (idx + 1 >= funnel.length) return cur;
  return funnel[idx + 1];
};

let ok = 0, fail = 0;
function t(lbl, got, exp) {
  const r = got === exp;
  console.log((r ? "OK  " : "FAIL") + " " + lbl + (r ? "" : ("  got:" + got + "  want:" + exp)));
  r ? ok++ : fail++;
}

const D = { funnel: ["greeting","qualification","offer","objection","close"] };

// computeNextStage — original logic unchanged
t("cns: qualification_site → qualification", computeNextStage("greeting","qualification_site"), "qualification");
t("cns: pricing → offer",                   computeNextStage("qualification","pricing"),        "offer");
t("cns: objection → objection",             computeNextStage("offer","objection"),              "objection");
t("cns: close → close",                     computeNextStage("objection","close"),              "close");
t("cns: unknown intent keeps stage",        computeNextStage("offer","unknown"),                "offer");

// getNextStage: no config → falls back to computeNextStage
t("gns: no config pricing→offer",           getNextStage("qualification","pricing",null),   "offer");
t("gns: no config unknown→keep",            getNextStage("offer","unknown",null),           "offer");

// getNextStage: with config.funnel → sequential
t("gns: greeting→qualification",   getNextStage("greeting",     "unknown", D), "qualification");
t("gns: qualification→offer",      getNextStage("qualification","unknown", D), "offer");
t("gns: offer→objection",          getNextStage("offer",        "unknown", D), "objection");
t("gns: objection→close",          getNextStage("objection",    "unknown", D), "close");
t("gns: close→close (end)",        getNextStage("close",        "unknown", D), "close");
t("gns: unknown→first stage",      getNextStage("bogus",        "unknown", D), "greeting");

// Custom funnel
const CF = { funnel: ["intro","demo","proposal","closed"] };
t("custom: intro→demo",            getNextStage("intro",   "unknown", CF), "demo");
t("custom: demo→proposal",         getNextStage("demo",    "unknown", CF), "proposal");
t("custom: proposal→closed",       getNextStage("proposal","unknown", CF), "closed");
t("custom: closed→closed (end)",   getNextStage("closed",  "unknown", CF), "closed");
t("custom: unknown→intro (first)", getNextStage("greeting","unknown", CF), "intro");

// verify defaultAssistantConfig has stageIntents
const cfg = require("/var/www/site-al.ru/apps/api/src/config/defaultAssistantConfig");
t("defaultConfig.stageIntents is object",            typeof cfg.stageIntents, "object");
t("stageIntents.objection = objection",              cfg.stageIntents.objection, "objection");
t("stageIntents.offer = pricing",                    cfg.stageIntents.offer, "pricing");
t("stageIntents.qualification = qualification_site", cfg.stageIntents.qualification, "qualification_site");
t("defaultConfig.funnel[0] = greeting",              cfg.funnel[0], "greeting");

console.log("\n" + (fail === 0
  ? "=== ALL " + ok + " TESTS PASSED ==="
  : "=== " + fail + " FAILED / " + ok + " passed ==="));
process.exit(fail > 0 ? 1 : 0);
