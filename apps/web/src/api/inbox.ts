import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";

export type InboxSource = "avito" | "web" | "telegram" | "api" | string;

export interface InboxTakeover {
  at:   string;
  by:   { id: string; email: string | null } | null;
  note: string | null;
}

export interface InboxConversation {
  id:             string;
  agentId:        string;
  source:         InboxSource;
  externalId:     string | null;
  externalUserId: string | null;
  title:          string | null;
  messageCount:   number;
  lastMessage:    { role: string | null; snippet: string };
  humanTakeover:  InboxTakeover | null;
  createdAt:      string;
  updatedAt:      string;
}

export interface InboxListResult {
  total:  number;
  limit:  number;
  offset: number;
  items:  InboxConversation[];
}

export interface InboxMessage {
  role:    string;
  content: string;
  /** "human" when a manager answered from admin UI */
  author?: string;
  userId?: string;
  sentAt?: string;
}

export interface InboxConversationMessages {
  conversationId: string;
  source:         InboxSource;
  externalId:     string | null;
  messages:       InboxMessage[];
}

export interface InboxListFilters {
  source?:   InboxSource | "";
  takeover?: "true" | "false" | "";
  q?:        string;
  limit?:    number;
  offset?:   number;
}

export const INBOX_LIST_KEY = (f: InboxListFilters) =>
  ["inbox-conversations", f.source ?? "", f.takeover ?? "", f.q ?? "", f.limit ?? 50, f.offset ?? 0] as const;

export const INBOX_MESSAGES_KEY = (id: string | null) =>
  ["inbox-messages", id ?? ""] as const;

function buildQuery(f: InboxListFilters): string {
  const params = new URLSearchParams();
  if (f.source)   params.set("source", f.source);
  if (f.takeover) params.set("takeover", f.takeover);
  if (f.q)        params.set("q", f.q);
  if (f.limit  != null) params.set("limit",  String(f.limit));
  if (f.offset != null) params.set("offset", String(f.offset));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function useInboxConversations(filters: InboxListFilters) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<InboxListResult>({
    queryKey: INBOX_LIST_KEY(filters),
    queryFn:  () => apiClient.get<InboxListResult>(`/inbox/conversations${buildQuery(filters)}`),
    enabled:  Boolean(accessToken),
    refetchInterval: 15_000,
  });
}

export function useInboxMessages(conversationId: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<InboxConversationMessages>({
    queryKey: INBOX_MESSAGES_KEY(conversationId),
    queryFn:  () =>
      apiClient.get<InboxConversationMessages>(
        `/inbox/conversations/${encodeURIComponent(conversationId ?? "")}/messages`
      ),
    enabled:  Boolean(accessToken) && Boolean(conversationId),
    refetchInterval: 10_000,
  });
}

export type SendInboxMessageResult = {
  ok:           true;
  message:      InboxMessage;
  conversation: InboxConversation;
};

export function useSendInboxMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { conversationId: string; text: string }) =>
      apiClient.post<SendInboxMessageResult>(
        `/inbox/conversations/${encodeURIComponent(p.conversationId)}/messages`,
        { text: p.text }
      ),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: INBOX_MESSAGES_KEY(vars.conversationId) });
      void qc.invalidateQueries({ queryKey: ["inbox-conversations"] });
      void qc.invalidateQueries({ queryKey: ["avito-conversations"] });
    },
  });
}
