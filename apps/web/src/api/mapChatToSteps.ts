import type { AgentExecutionStep, ChatReply } from "./types";

export type MapChatToStepsOptions = {
  /** У агента есть инструменты, но в ответе /chat нет факта вызова — показываем placeholder. */
  agentHasTools?: boolean;
};

/**
 * Адаптер: ответ /chat → те же AgentExecutionStep[], что ожидает UI.
 * Когда бэкенд начнёт отдавать шаги — подставьте их напрямую, этот адаптер не нужен.
 */
export function mapChatToSteps(
  runId: string,
  userMessage: string,
  chatReply: ChatReply,
  options?: MapChatToStepsOptions
): AgentExecutionStep[] {
  const steps: AgentExecutionStep[] = [
    {
      id: `${runId}-thinking`,
      type: "thinking",
      content: userMessage,
    },
  ];

  if (options?.agentHasTools) {
    steps.push({
      id: `${runId}-tool-placeholder`,
      type: "tool",
      content: "type: tool (not executed)",
    });
  }

  const output: unknown =
    chatReply.warning != null && chatReply.warning !== ""
      ? { reply: chatReply.reply, warning: chatReply.warning }
      : chatReply.reply;

  steps.push({
    id: `${runId}-response`,
    type: "response",
    content: `Модель: ${chatReply.model}`,
    output,
  });

  return steps;
}
