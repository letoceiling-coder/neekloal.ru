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
    /** Строго на поток: без общего ключа для всех диалогов. */
    messages: (conversationId: string) => ["messages", conversationId] as const,
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
  billing: {
    summary: ["billing", "summary"] as const,
  },
  admin: {
    gate: ["admin", "gate"] as const,
    organizations: ["admin", "organizations"] as const,
    users: ["admin", "users"] as const,
    plans: ["admin", "plans"] as const,
    usage: (limit: number, offset: number, organizationId: string, model: string) =>
      ["admin", "usage", limit, offset, organizationId, model] as const,
    leads: ["admin", "leads"] as const,
    lead: (id: string) => ["admin", "leads", id] as const,
  },
} as const;
