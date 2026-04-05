"use strict";

const { getVideoQueue } = require("../queues/videoQueue");
const prisma = require("../lib/prisma");

/**
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.organizationId
 * @param {string} p.imageUrl
 * @param {string} p.script
 * @param {string} [p.voiceText]
 * @param {'ltx'|'standard'} [p.mode] default ltx (ComfyUI pipeline + fallback)
 * @param {{ type: 'telegram', token: string, chatId: number|string } | null} [p.notify]
 */
async function createAndEnqueueVideoJob(p) {
  const script = typeof p.script === "string" ? p.script : "";
  const voiceText = p.voiceText != null && String(p.voiceText).trim() ? String(p.voiceText).trim() : null;
  const mode = p.mode === "standard" ? "standard" : "ltx";

  const row = await prisma.videoGenerationJob.create({
    data: {
      userId: p.userId,
      organizationId: p.organizationId,
      status: "queued",
      mode,
      imageUrl: p.imageUrl,
      script: script || " ",
      voiceText,
    },
  });

  await getVideoQueue().add(
    "render",
    {
      videoJobId: row.id,
      userId: p.userId,
      organizationId: p.organizationId,
      imageUrl: p.imageUrl,
      script: script || " ",
      voiceText,
      mode,
      notify: p.notify || null,
    },
    { jobId: row.id }
  );

  return row;
}

module.exports = { createAndEnqueueVideoJob };
