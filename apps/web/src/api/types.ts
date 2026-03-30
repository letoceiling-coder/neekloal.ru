/** Ответ GET /usage */
export type UsageAggregate = {
  totalRequests: number;
  totalTokens: number;
  byModel: Record<string, { requests: number; tokens: number }>;
};

/** Элемент GET /assistants */
export type Assistant = {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  userId?: string;
  createdAt?: string;
};

export type CreateAssistantInput = {
  name: string;
  model: string;
  systemPrompt: string;
};

/** Инструмент агента (GET /agents include tools) */
export type AgentTool = {
  id: string;
  name: string;
  type: string;
  config?: unknown;
};

/**
 * Унифицированный шаг выполнения агента.
 * Источник: POST /chat (через mapChatToSteps) или будущий API с реальными шагами.
 */
export type AgentExecutionStep = {
  id: string;
  type: "thinking" | "tool" | "response";
  content?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

/** Элемент GET /agents */
export type Agent = {
  id: string;
  name: string;
  type: string;
  mode: string;
  assistantId: string | null;
  rules?: string | null;
  userId?: string;
  createdAt?: string;
  tools?: AgentTool[];
};

export type UpdateAssistantInput = {
  name?: string;
  model?: string;
  systemPrompt?: string;
  config?: Record<string, unknown> | null;
};

/** Human-readable explanation of auto-agent config */
export type AutoAgentExplanation = {
  summary: string;
  funnelDescription: Array<{
    step: number;
    stage: string;
    label: string;
    icon: string;
    description: string;
  }>;
  intentsDescription: Array<{
    intent: string;
    label: string;
    icon: string;
    triggers: string[];
    description: string;
  }>;
  memoryDescription: Array<{
    field: string;
    label: string;
    desc: string;
    icon: string;
  }>;
  exampleDialog: Array<{
    role: "user" | "ai";
    text: string;
    stage?: string;
    stageLabel?: string;
  }>;
  meta: {
    stagesCount: number;
    intentsCount: number;
    memoryFieldsCount: number;
    maxSentences: number;
  };
};

/** Result of POST /ai/auto-agent and POST /ai/auto-agent/refine */
export type AutoAgentResult = {
  systemPrompt: string;
  config: {
    intents: Record<string, string[]>;
    memory: string[];
    funnel: string[];
    validation: { maxSentences: number; questions: number };
  };
  explanation: AutoAgentExplanation;
};

export type UpdateAgentInput = {
  name?: string;
  rules?: string | null;
  assistantId?: string | null;
  mode?: string;
};

/** Ожидаемый контракт GET /conversations (когда появится на бэкенде) */
export type Conversation = {
  id: string;
  assistantId: string;
  userId?: string;
  createdAt?: string;
};

export type CreateConversationInput = {
  assistantId: string;
};

/** Локальный статус доставки (без изменений API). */
export type ChatMessageClientStatus = "sending" | "sent" | "failed";

/** Сообщение в UI чата (история с сервера или локально после POST /chat). */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  /** Только клиент: optimistic / ошибка сети. */
  clientStatus?: ChatMessageClientStatus;
};

/** Ответ POST /chat */
export type ChatReply = {
  reply: string;
  model: string;
  warning?: string;
};
