"use strict";

/**
 * avito.audit.js — structured audit logging for Avito pipeline.
 *
 * Each processed message gets one AvitoAuditLog row capturing the full
 * pipeline state: input → classifier → router → AI → send result.
 *
 * Non-blocking: write failures are logged but never throw.
 */

const prisma = require("../../lib/prisma");

/**
 * Save a pipeline audit record to the database.
 *
 * @param {{
 *   agentId:        string,
 *   organizationId: string,
 *   chatId:         string,
 *   authorId:       string,
 *   conversationId: string | null,
 *   eventId:        string | null,
 *   input:          string,
 *   output:         string | null,
 *   classification: object | null,
 *   decision:       string,
 *   modelUsed:      string | null,
 *   tokens:         number | null,
 *   durationMs:     number | null,
 *   success:        boolean,
 *   error:          string | null,
 * }} data
 * @returns {Promise<void>}
 */
async function saveAudit(data) {
  try {
    await prisma.avitoAuditLog.create({
      data: {
        agentId:        data.agentId,
        organizationId: data.organizationId,
        chatId:         data.chatId,
        authorId:       data.authorId,
        conversationId: data.conversationId ?? null,
        eventId:        data.eventId        ?? null,
        input:          String(data.input   ?? ""),
        output:         data.output         ?? null,
        classification: data.classification ?? undefined,
        decision:       String(data.decision ?? "unknown"),
        modelUsed:      data.modelUsed      ?? null,
        tokens:         data.tokens         ?? null,
        durationMs:     data.durationMs     ?? null,
        success:        data.success        ?? true,
        error:          data.error          ?? null,
      },
    });
    process.stdout.write(
      `[avito:audit] saved agentId=${data.agentId} decision=${data.decision} ` +
      `success=${data.success} ms=${data.durationMs ?? "?"}\n`
    );
  } catch (err) {
    // Non-fatal: audit failure must never break the pipeline
    process.stderr.write(`[avito:audit] save failed: ${err.message}\n`);
  }
}

module.exports = { saveAudit };
