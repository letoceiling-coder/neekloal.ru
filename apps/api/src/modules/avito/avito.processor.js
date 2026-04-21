"use strict";

/**
 * avito.processor.js — BullMQ job processor for Avito messages.
 *
 * Full pipeline per message:
 *   1.  Extract & validate job data
 *   2.  Load agent from DB
 *   3.  Resolve Avito credentials (DB account → env fallback)
 *   4.  Anti-loop guard (skip own messages)
 *   5.  Find-or-create AgentConversation (source="avito")
 *   6.  Classify message
 *   7.  Upsert AvitoLead FSM row (create or update intent/status/phone)
 *   8.  Apply FSM transition (resolveNextState)
 *   9.  Phone extraction — if found: set phone + force HANDOFF
 *  10.  CRM: first contact → create Lead; subsequent → sync status
 *  11.  Route → decision (autoreply | copilot | human | skip)
 *  12.  HANDOFF guard: stop AI, log [avito:handoff]
 *  13.  Build system prompt (sales FSM prompt + agent.rules)
 *  14.  AI response (autoreply / copilot)
 *  15.  Send to Avito (autoreply only, with 1 retry)
 *  16.  Save AvitoAuditLog
 *
 * NOT_TOUCHING: agentRuntime.js (V1), any existing route outside /modules/avito
 */

const prisma                              = require("../../lib/prisma");
const { agentChatV2,
        findOrCreateExternalConversation } = require("../../services/agentRuntimeV2");
const { createClient }                    = require("../../services/avitoClient");
const { resolveAccountCredentials }       = require("./avito.credentials");
const { classifyMessage }                 = require("./avito.classifier");
const { routeMessage }                    = require("./avito.router");
const { saveAudit }                       = require("./avito.audit");
const { maybeCreateLead, syncLeadStatus } = require("./avito.crm");
const { resolveNextState, extractPhone }  = require("./avito.fsm");
const { scheduleFollowUps, cancelFollowUps } = require("./avito.followup.queue");
const { buildAvitoSystemPrompt }          = require("./avito.prompt");
const { loadAvitoKnowledgeBlock }         = require("./avito.knowledge");
const { sendHandoffAlert, sendNewLeadAlert } = require("../../services/notifyManager");

// ── Retry helper ──────────────────────────────────────────────────────────────

async function retryOnce(fn, delayMs = 2_000) {
  try {
    return await fn();
  } catch (firstErr) {
    process.stderr.write(`[avito:send] first attempt failed (${firstErr.message}) — retrying in ${delayMs}ms\n`);
    await new Promise((r) => setTimeout(r, delayMs));
    return await fn();
  }
}

// ── Main processor ────────────────────────────────────────────────────────────

/**
 * Process a single "avito_message" BullMQ job.
 * @param {import("bullmq").Job} job
 */
async function processAvitoJob(job) {
  const { agentId, eventId, chatId, authorId, text } = job.data ?? {};
  const startMs = Date.now();

  process.stdout.write(
    `[avito:processor] start job=${job.id} agentId=${agentId} chatId=${chatId} ` +
    `from=${authorId} text="${String(text ?? "").slice(0, 60)}"\n`
  );

  const audit = {
    agentId,
    organizationId: null,
    chatId,
    authorId,
    conversationId: null,
    eventId,
    input:          text,
    output:         null,
    classification: null,
    decision:       "unknown",
    modelUsed:      null,
    tokens:         null,
    durationMs:     null,
    success:        true,
    error:          null,
  };

  try {
    // ── 1. Validate ─────────────────────────────────────────────────────────
    if (!agentId || !chatId || !authorId) {
      throw new Error(`Invalid job data: missing agentId/chatId/authorId`);
    }

    // ── 2. Load agent (+ assistant for voice & knowledge) ────────────────────
    const agent = await prisma.agent.findFirst({
      where:   { id: agentId, deletedAt: null },
      include: { avitoAccount: true, assistant: true },
    });
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    audit.organizationId = agent.organizationId;

    if (!agent.assistantId) {
      process.stdout.write(
        `[avito:processor] WARN agent=${agentId} has no assistantId — using generic sales prompt only\n`
      );
    }

    // ── 3. Resolve Avito credentials ──────────────────────────────────────────
    let avitoClient = null;
    let myAccountId = null;

    if (agent.avitoAccount?.isActive) {
      const acc = agent.avitoAccount;
      try {
        const creds = await resolveAccountCredentials(acc);
        myAccountId = creds.accountId;
        avitoClient = createClient({ token: creds.accessToken, accountId: creds.accountId });
        process.stdout.write(`[avito:processor] using DB account id=${acc.id} name="${acc.name ?? ""}"\n`);
      } catch (e) {
        process.stderr.write(`[avito:processor] DB account credentials invalid: ${e.message}\n`);
      }
    } else if (process.env.AVITO_TOKEN && process.env.AVITO_ACCOUNT_ID) {
      myAccountId = process.env.AVITO_ACCOUNT_ID;
      try {
        avitoClient = createClient({
          token:     process.env.AVITO_TOKEN,
          accountId: process.env.AVITO_ACCOUNT_ID,
        });
        process.stdout.write(`[avito:processor] using env-based Avito credentials (legacy)\n`);
      } catch (e) {
        process.stderr.write(`[avito:processor] env credentials invalid: ${e.message}\n`);
      }
    }

    // ── 4. Anti-loop ─────────────────────────────────────────────────────────
    if (myAccountId && String(authorId) === String(myAccountId)) {
      process.stdout.write(`[avito:processor] skip own message chatId=${chatId}\n`);
      audit.decision = "skip";
      return;
    }

    // ── 5. Find or create conversation ───────────────────────────────────────
    const conv = await findOrCreateExternalConversation(
      agentId,
      agent.organizationId,
      chatId,
      authorId,
      "avito"
    );
    audit.conversationId = conv.id;

    const isFirstMessage = !Array.isArray(conv.messages) || conv.messages.length === 0;

    // ── 6. Classify ──────────────────────────────────────────────────────────
    const classification = classifyMessage(text);
    audit.classification = classification;

    // ── 7. Upsert AvitoLead FSM row ──────────────────────────────────────────
    // Capture previous (status, isHot) BEFORE upsert, so we can detect
    // transitions NEW→HANDOFF and isHot=false→true and fire a single alert.
    const prev = await prisma.avitoLead.findUnique({
      where:  { agentId_chatId: { agentId, chatId } },
      select: { status: true, isHot: true },
    });
    const prevStatus = prev ? prev.status : null;
    const prevIsHot  = prev ? Boolean(prev.isHot) : false;

    let lead = await prisma.avitoLead.upsert({
      where:  { agentId_chatId: { agentId, chatId } },
      create: {
        agentId,
        conversationId: conv.id,
        chatId,
        externalUserId: String(authorId),
        status:         "NEW",
        intent:         classification.intent,
        priority:       classification.priority,
        isHot:          classification.isHotLead,
        lastMessageAt:  new Date(),
      },
      update: {
        intent:        classification.intent,
        priority:      classification.priority,
        isHot:         classification.isHotLead,
        lastMessageAt: new Date(),
      },
    });

    // ── 8. FSM transition ─────────────────────────────────────────────────────
    const nextStatus = resolveNextState(lead, classification);
    if (nextStatus !== lead.status) {
      lead = await prisma.avitoLead.update({
        where: { id: lead.id },
        data:  { status: nextStatus },
      });
      process.stdout.write(
        `[avito:fsm] lead=${lead.id} ${lead.status} → wait... updated to ${nextStatus}\n`
      );
    }
    // Reflect updated status in the in-memory object
    lead = { ...lead, status: nextStatus };

    process.stdout.write(
      `[avito:fsm] lead=${lead.id} status=${lead.status} intent=${classification.intent} isHot=${lead.isHot}\n`
    );

    // ── 9. Phone extraction ───────────────────────────────────────────────────
    const detectedPhone = extractPhone(text);
    if (detectedPhone && !lead.phone) {
      lead = await prisma.avitoLead.update({
        where: { id: lead.id },
        data:  { phone: detectedPhone, status: "HANDOFF" },
      });
      process.stdout.write(
        `[avito:contact] phone=${detectedPhone} chatId=${chatId} → HANDOFF\n`
      );
      lead = { ...lead, status: "HANDOFF" };
    }

    // ── 9.1 Manager alert on HANDOFF or hot-lead transition ──────────────────
    // Fire-and-forget: errors are logged but never break the pipeline.
    // Suppress the alert if a human has already taken the dialog to work —
    // they know the context better than a Telegram notification.
    const becameHandoff = prevStatus !== "HANDOFF" && lead.status === "HANDOFF";
    const becameHot     = !prevIsHot && Boolean(lead.isHot);

    if ((becameHandoff || becameHot) && !conv.humanTakeoverAt) {
      const chatUrl = `https://site-al.ru/avito?chatId=${encodeURIComponent(chatId)}`;
      const convMessages = Array.isArray(conv.messages) ? conv.messages : [];
      // Append the current inbound message so the brief reflects latest context.
      const messagesForBrief = convMessages.concat([{ role: "user", content: String(text || "") }]);

      void sendHandoffAlert({
        organizationId: agent.organizationId,
        leadId:         lead.id,
        source:         "avito",
        chatId,
        externalUserId: String(authorId),
        phone:          detectedPhone || lead.phone || undefined,
        intent:         classification.intent,
        status:         lead.status,
        isHot:          Boolean(lead.isHot),
        chatUrl,
        messages:       messagesForBrief,
      }).then((r) => {
        if (r.ok) {
          process.stdout.write(
            `[notifyManager] alert sent org=${agent.organizationId} lead=${lead.id} ` +
            `reason=${becameHandoff ? "handoff" : "hot"}\n`
          );
        } else if (r.skipped) {
          process.stdout.write(
            `[notifyManager] alert skipped org=${agent.organizationId} lead=${lead.id} reason=${r.skipped}\n`
          );
        }
      }).catch((err) => {
        process.stderr.write(
          `[notifyManager] alert error org=${agent.organizationId}: ${err && err.message ? err.message : String(err)}\n`
        );
      });
    }

    // ── 10. CRM sync ─────────────────────────────────────────────────────────
    if (isFirstMessage) {
      // New lead alert for Avito first contact (separate from handoff/hot alerts).
      // Uses per-org Telegram settings notifyOnNewLead.
      void sendNewLeadAlert({
        organizationId: agent.organizationId,
        leadId:         lead.id,
        source:         "avito",
        name:           String(authorId),
        phone:          detectedPhone || lead.phone || undefined,
        firstMessage:   text,
        chatUrl:        `https://site-al.ru/avito?chatId=${encodeURIComponent(chatId)}`,
      }).then((r) => {
        if (r.ok) {
          process.stdout.write(
            `[notifyManager] new-lead sent org=${agent.organizationId} lead=${lead.id}\n`
          );
        } else if (r.skipped) {
          process.stdout.write(
            `[notifyManager] new-lead skipped org=${agent.organizationId} lead=${lead.id} reason=${r.skipped}\n`
          );
        }
      }).catch((err) => {
        process.stderr.write(
          `[notifyManager] new-lead error org=${agent.organizationId}: ${err && err.message ? err.message : String(err)}\n`
        );
      });

      await maybeCreateLead({
        organizationId: agent.organizationId,
        chatId,
        authorId,
        firstMessage:   text,
        isHotLead:      classification.isHotLead,
        avitoStatus:    lead.status,
      });
    } else {
      await syncLeadStatus({
        organizationId: agent.organizationId,
        authorId,
        avitoStatus:    lead.status,
      });
    }

    // ── 11. Follow-up scheduling ──────────────────────────────────────────────
    // Every inbound message: cancel old pending follow-ups and schedule new sequence.
    // If conversation is on human-takeover — cancel and do not reschedule.
    // Non-fatal — never blocks the main pipeline.
    try {
      const leadStoppedStates = lead.status === "HANDOFF" || lead.status === "CLOSED" || lead.status === "LOST";
      if (conv.humanTakeoverAt) {
        await cancelFollowUps({ agentId, chatId, reason: "human_takeover" });
      } else if (leadStoppedStates) {
        await cancelFollowUps({ agentId, chatId, reason: `lead.status=${lead.status}` });
      } else {
        await scheduleFollowUps({ agentId, chatId, leadId: lead.id });
      }
    } catch (fuErr) {
      process.stderr.write(`[followup:schedule] error (non-fatal): ${fuErr.message}\n`);
    }

    // ── 12. Route ─────────────────────────────────────────────────────────────
    const routing = routeMessage(agent, classification, lead);
    audit.decision = routing.decision;

    process.stdout.write(
      `[avito:router] decision=${routing.decision} reason="${routing.reason}"\n`
    );

    // ── 13. HANDOFF guard — stop AI completely ────────────────────────────────
    if (lead.status === "HANDOFF") {
      process.stdout.write(
        `[avito:handoff] stopped AI lead=${lead.id} chatId=${chatId}\n`
      );
      audit.success = true;
      return;
    }

    // ── 13.1 Human takeover guard — manager took this dialog to work ─────────
    // `humanTakeoverAt` is set from admin UI (POST /conversations/:id/takeover).
    // Until release, AI must not reply on this conversation.
    if (conv.humanTakeoverAt) {
      audit.decision = "human_takeover";
      audit.success  = true;
      process.stdout.write(
        `[avito:takeover] AI paused conv=${conv.id} since=${conv.humanTakeoverAt instanceof Date ? conv.humanTakeoverAt.toISOString() : conv.humanTakeoverAt}\n`
      );
      return;
    }

    if (routing.decision === "skip" || routing.decision === "human") {
      audit.success = true;
      return;
    }

    // ── 14. Build system prompt — russian lock + voice + FSM + assistant + knowledge + rules
    const { knowledgeBlock, source: knowledgeSource } = await loadAvitoKnowledgeBlock({
      assistantId:    agent.assistantId,
      organizationId: agent.organizationId,
      message:        text,
    });

    process.stdout.write(
      `[avito:processor] knowledge source=${knowledgeSource} chars=${knowledgeBlock.length} assistantId=${agent.assistantId ?? "-"}\n`
    );

    const systemPrompt = buildAvitoSystemPrompt({
      lead,
      agent,
      assistant: agent.assistant || null,
      knowledgeBlock,
    });

    // ── 15. AI response (autoreply OR copilot) ────────────────────────────────
    let aiResult;
    try {
      aiResult = await agentChatV2({
        conversationId: conv.id,
        message:        text,
        organizationId: agent.organizationId,
        systemPrompt,
        model: agent.model || null,
      });
    } catch (aiErr) {
      audit.error   = `agentChatV2: ${aiErr.message}`;
      audit.success = false;
      throw aiErr;
    }

    audit.output    = aiResult.reply;
    audit.modelUsed = aiResult.modelUsed;
    audit.tokens    = aiResult.tokens?.total ?? null;

    process.stdout.write(
      `[avito:processor] AI reply model=${aiResult.modelUsed} chars=${aiResult.reply.length}\n`
    );

    // ── 16. Send to Avito (autoreply only) ────────────────────────────────────
    if (routing.decision === "autoreply") {
      if (!avitoClient) {
        process.stderr.write(
          `[avito:processor] no Avito credentials — reply saved to DB but NOT sent chatId=${chatId}\n`
        );
      } else {
        await retryOnce(() => avitoClient.sendMessage(chatId, aiResult.reply));
      }
    } else {
      process.stdout.write(
        `[avito:processor] copilot: reply saved to DB chatId=${chatId} — NOT sent\n`
      );
    }

  } catch (err) {
    audit.success = false;
    audit.error   = err.message;
    process.stderr.write(`[avito:processor] ✗ job=${job.id} err="${err.message}"\n`);
    throw err;
  } finally {
    audit.durationMs = Date.now() - startMs;
    if (audit.organizationId) {
      await saveAudit(audit);
    }
  }
}

module.exports = { processAvitoJob };
