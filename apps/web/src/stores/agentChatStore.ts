import { create } from "zustand";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentChatState {
  /** Messages keyed by agentId */
  messagesByAgent: Record<string, ChatMessage[]>;
  addMessage:   (agentId: string, message: ChatMessage) => void;
  setMessages:  (agentId: string, messages: ChatMessage[]) => void;
  clearMessages:(agentId: string) => void;
  getMessages:  (agentId: string) => ChatMessage[];
}

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  messagesByAgent: {},

  addMessage: (agentId, message) =>
    set((s) => ({
      messagesByAgent: {
        ...s.messagesByAgent,
        [agentId]: [...(s.messagesByAgent[agentId] ?? []), message],
      },
    })),

  setMessages: (agentId, messages) =>
    set((s) => ({
      messagesByAgent: { ...s.messagesByAgent, [agentId]: messages },
    })),

  clearMessages: (agentId) =>
    set((s) => ({
      messagesByAgent: { ...s.messagesByAgent, [agentId]: [] },
    })),

  getMessages: (agentId) => get().messagesByAgent[agentId] ?? [],
}));
