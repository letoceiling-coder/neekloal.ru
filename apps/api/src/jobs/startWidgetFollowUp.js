"use strict";

const { runWidgetFollowUpSweep } = require("../services/widgetFollowUp");

/**
 * Периодический обход виджет-диалогов для follow-up (без отдельного воркера).
 * @param {{ info?: Function; warn?: Function; error?: Function }} logger
 * @returns {NodeJS.Timeout}
 */
function startWidgetFollowUpSweep(logger) {
  const intervalMs = Number(process.env.WIDGET_FOLLOWUP_POLL_MS) || 60_000;
  const tid = setInterval(() => {
    runWidgetFollowUpSweep(logger).catch((err) => {
      logger?.error?.(err);
    });
  }, intervalMs);
  if (typeof tid.unref === "function") {
    tid.unref();
  }
  return tid;
}

module.exports = { startWidgetFollowUpSweep };
