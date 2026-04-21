import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";
import type { Agent, ChatReply, UpdateAgentInput } from "./types";

// ── Agent Conversation V2 types ───────────────────────────────────────────────

export interface AgentConversationMeta {
  id:           string;
  agentId:      string;
  title:        string | null;
  messageCount: number;
  createdAt:    string;
  updatedAt:    string;
}

export interface ConversationMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface AgentConversationFull extends AgentConversationMeta {
  messages: ConversationMessage[];
}

export interface CreateConversationRequest {
  agentId: string;
  title?:  string;
}

export interface AgentChatV2Request {
  conversationId: string;
  message:        string;
  model?:         string;
  systemPrompt?:  string;
  temperature?:   number;
  maxTokens?:     number;
}

export interface AgentChatV2Response {
  reply:          string;
  modelUsed:      string;
  tokens:         { prompt: number; completion: number; total: number };
  contextLength:  number;
  conversationId: string;
}

// ── Agent Chat Playground types (V1) ─────────────────────────────────────────

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
  name:        string;
  type:        string;
  mode?:       string;
  model?:      string | null;
  assistantId?: string | null;
  rules?:      string | null;
  trigger?:    string | null;
  flow?:       unknown;
  memory?:     unknown;
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

// ── Agent Conversation V2 hooks ───────────────────────────────────────────────

export function useCreateConversation() {
  return useMutation({
    mutationFn: (body: CreateConversationRequest) =>
      apiClient.post<AgentConversationFull>("/agents/conversations", body),
  });
}

export function useConversations(agentId: string | undefined) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["agent-conversations", agentId],
    queryFn:  () =>
      apiClient.get<{ conversations: AgentConversationMeta[] }>(`/agents/conversations/${agentId}`),
    enabled:  Boolean(accessToken) && Boolean(agentId),
    staleTime: 30_000,
  });
}

export function useConversationDetail(conversationId: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["agent-conversation-detail", conversationId],
    queryFn:  () =>
      apiClient.get<AgentConversationFull>(`/agents/conversations/detail/${conversationId}`),
    enabled:  Boolean(accessToken) && Boolean(conversationId),
    staleTime: 0, // always fresh
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/agents/conversations/${id}`),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
      void queryClient.removeQueries({ queryKey: ["agent-conversation-detail", id] });
    },
  });
}

export function useAgentChatV2() {
  return useMutation({
    mutationFn: (body: AgentChatV2Request) =>
      apiClient.post<AgentChatV2Response>("/agents/chat/v2", body),
  });
}

// ── Available models ──────────────────────────────────────────────────────────

export interface ModelInfo {
  name:         string;
  size?:        number;
  modified_at?: string;
  /** ollama | openai | anthropic | … — when from cloud integrations */
  provider?: string;
  /** chat | tts | image_or_llm */
  kind?: string;
}

export function useModels() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.models.all,
    queryFn:  () => apiClient.get<{ models: ModelInfo[] }>("/models"),
    enabled:  Boolean(accessToken),
    staleTime: 60_000,
  });
}
