"use strict";

const { finalizeChatUsage } = require("./planAccess");

/**
 * Биллинг после agent execution: списание лимитов по токенам (как в чате).
 * @param {object} params
 * @param {string} params.organizationId
 * @param {string} params.userId
 * @param {string|null|undefined} params.assistantId
 * @param {string|null|undefined} params.conversationId
 * @param {string} params.model
 * @param {number} params.promptTokens
 * @param {number} params.completionTokens
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
async function recordAgentExecutionUsage(params) {
  const {
    organizationId,
    userId,
    assistantId,
    conversationId,
    model,
    promptTokens,
    completionTokens,
  } = params;

  return finalizeChatUsage({
    organizationId,
    userId,
    apiKeyId: null,
    assistantId: assistantId ?? null,
    conversationId: conversationId ?? null,
    model,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
  });
}

module.exports = {
  recordAgentExecutionUsage,
};
