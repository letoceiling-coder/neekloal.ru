import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlaygroundRole = "user" | "assistant";

export interface PlaygroundMessage {
  role:    PlaygroundRole;
  content: string;
}

export type PlaygroundFsmStatus =
  | "NEW"
  | "QUALIFYING"
  | "INTERESTED"
  | "HANDOFF"
  | "CLOSED"
  | "LOST";

export interface PlaygroundChatInput {
  agentId:    string;
  messages:   PlaygroundMessage[];
  fsmStatus?: PlaygroundFsmStatus;
}

export interface PlaygroundClassification {
  intent:     string;
  priority:   string;
  isHotLead?: boolean;
}

export interface PlaygroundChatResponse {
  reply:    string;
  stopped:  boolean;
  reason?:  string;
  classification: PlaygroundClassification;
  fsm: {
    previous: PlaygroundFsmStatus;
    next:     PlaygroundFsmStatus;
    phone:    string | null;
  };
  knowledge: {
    source: "rag" | "db" | "none";
    chars:  number;
  };
  model: {
    requested: string | null;
    used:      string | null;
  };
  tokens: {
    prompt:     number;
    completion: number;
    total:      number;
  } | null;
  durationMs?:         number;
  systemPromptPreview: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePlaygroundChat() {
  return useMutation({
    mutationFn: (input: PlaygroundChatInput) =>
      apiClient.post<PlaygroundChatResponse>("/avito/playground/chat", input),
  });
}
