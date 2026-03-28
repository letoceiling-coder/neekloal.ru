/** Ключи React Query — синхронизировать с хуками в `src/api/`. */
export const queryKeys = {
  assistants: {
    all: ["assistants"] as const,
    detail: (id: string) => ["assistants", id] as const,
  },
  agents: {
    all: ["agents"] as const,
    detail: (id: string) => ["agents", id] as const,
  },
  conversations: {
    all: ["conversations"] as const,
    detail: (id: string) => ["conversations", id] as const,
    messages: (conversationId: string) =>
      ["conversations", conversationId, "messages"] as const,
  },
  knowledge: {
    all: ["knowledge"] as const,
  },
  apiKeys: {
    all: ["api-keys"] as const,
  },
  usage: {
    all: ["usage"] as const,
  },
} as const;
