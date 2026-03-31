import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { Agent, ChatReply, UpdateAgentInput } from "./types";

// ── Agent Chat Playground types ───────────────────────────────────────────────

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentChatRequest {
  agentId:   string;
  messages:  AgentChatMessage[];
  model?:    string;
  reset?:    boolean;
}

export interface AgentChatResponse {
  reply:         string;
  modelUsed:     string;
  tokens:        { prompt: number; completion: number; total: number };
  contextLength: number;
}

export function useAgents() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.agents.all,
    queryFn: () => apiClient.get<Agent[]>("/agents"),
    enabled: Boolean(accessToken),
  });
}

type CreateAgentInput = {
  name: string;
  type: string;
  mode?: string;
  assistantId?: string | null;
  rules?: string | null;
  trigger?: string | null;
  flow?: unknown;
  memory?: unknown;
};

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAgentInput) =>
      apiClient.post<Agent>("/agents", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function usePatchAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateAgentInput) =>
      apiClient.patch<Agent>(`/agents/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
    },
  });
}

export function useAutoGenerateAgent() {
  return useMutation({
    mutationFn: ({ input, assistantId }: { input: string; assistantId?: string }) =>
      apiClient.post<{ rules: string }>("/agents/auto-generate", { input, assistantId }),
  });
}

/** Запуск сценария через существующий POST /chat (assistant привязан к агенту на сервере). */
export async function postAgentChat(
  assistantId: string,
  message: string
): Promise<ChatReply> {
  return apiClient.post<ChatReply>("/chat", {
    assistantId: assistantId.trim(),
    message: message.trim(),
  });
}

export function useRunAgentChat() {
  return useMutation({
    mutationFn: ({
      assistantId,
      message,
    }: {
      assistantId: string;
      message: string;
    }) => postAgentChat(assistantId, message),
  });
}

// ── Agent Playground chat ─────────────────────────────────────────────────────

export function useAgentChatMutation() {
  return useMutation({
    mutationFn: (body: AgentChatRequest) =>
      apiClient.post<AgentChatResponse>("/agents/chat", body),
  });
}

// ── Available models ──────────────────────────────────────────────────────────

export function useModels() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.models.all,
    queryFn:  () => apiClient.get<{ models: string[] }>("/models"),
    enabled:  Boolean(accessToken),
    staleTime: 60_000,
  });
}
