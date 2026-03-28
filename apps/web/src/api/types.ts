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

/** Элемент GET /agents */
export type Agent = {
  id: string;
  name: string;
  type: string;
  mode: string;
  assistantId: string | null;
  userId?: string;
  createdAt?: string;
  tools?: unknown[];
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
