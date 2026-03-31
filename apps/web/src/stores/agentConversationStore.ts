import { create } from "zustand";

export interface ConversationMeta {
  id:           string;
  agentId:      string;
  title:        string | null;
  messageCount: number;
  createdAt:    string;
  updatedAt:    string;
}

export interface StoredMessage {
  role:    "user" | "assistant";
  content: string;
}

interface AgentConversationState {
  /** Conversations keyed by agentId */
  conversationsByAgent: Record<string, ConversationMeta[]>;
  /** Currently active conversation id */
  activeConversationId: string | null;
  /** Locally loaded messages for the active conversation */
  messages: StoredMessage[];

  setConversations:    (agentId: string, convs: ConversationMeta[]) => void;
  addConversation:     (agentId: string, conv: ConversationMeta) => void;
  removeConversation:  (agentId: string, id: string) => void;
  setActiveConversation: (id: string | null) => void;
  getConversations:    (agentId: string) => ConversationMeta[];

  setMessages:  (messages: StoredMessage[]) => void;
  appendMessage:(msg: StoredMessage) => void;
  clearMessages:() => void;

  /** Update message count after a new turn */
  bumpMessageCount: (agentId: string, conversationId: string, by?: number) => void;
}

export const useAgentConversationStore = create<AgentConversationState>((set, get) => ({
  conversationsByAgent: {},
  activeConversationId: null,
  messages:             [],

  setConversations: (agentId, convs) =>
    set((s) => ({
      conversationsByAgent: { ...s.conversationsByAgent, [agentId]: convs },
    })),

  addConversation: (agentId, conv) =>
    set((s) => ({
      conversationsByAgent: {
        ...s.conversationsByAgent,
        [agentId]: [conv, ...(s.conversationsByAgent[agentId] ?? [])],
      },
    })),

  removeConversation: (agentId, id) =>
    set((s) => ({
      conversationsByAgent: {
        ...s.conversationsByAgent,
        [agentId]: (s.conversationsByAgent[agentId] ?? []).filter((c) => c.id !== id),
      },
    })),

  setActiveConversation: (id) => set({ activeConversationId: id }),

  getConversations: (agentId) => get().conversationsByAgent[agentId] ?? [],

  setMessages:   (messages) => set({ messages }),
  appendMessage: (msg)      => set((s) => ({ messages: [...s.messages, msg] })),
  clearMessages: ()         => set({ messages: [] }),

  bumpMessageCount: (agentId, conversationId, by = 2) =>
    set((s) => ({
      conversationsByAgent: {
        ...s.conversationsByAgent,
        [agentId]: (s.conversationsByAgent[agentId] ?? []).map((c) =>
          c.id === conversationId
            ? { ...c, messageCount: c.messageCount + by, updatedAt: new Date().toISOString() }
            : c
        ),
      },
    })),
}));
