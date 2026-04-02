import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AvitoAccount {
  id:               string;
  organizationId:   string;
  name:             string | null;
  accountId:        string;
  isActive:         boolean;
  hasToken:         boolean;
  hasWebhookSecret: boolean;
  createdAt:        string;
  updatedAt:        string;
}

export interface CreateAvitoAccountInput {
  name?:          string;
  accessToken:    string;
  accountId:      string;
  webhookSecret?: string;
  isActive?:      boolean;
}

export interface PatchAvitoAccountInput {
  name?:          string | null;
  accessToken?:   string;
  accountId?:     string;
  webhookSecret?: string | null;
  isActive?:      boolean;
}

export interface AvitoConversation {
  id:             string;
  agentId:        string;
  chatId:         string;
  externalUserId: string;
  title:          string | null;
  messageCount:   number;
  createdAt:      string;
  updatedAt:      string;
}

export interface AvitoAuditLog {
  id:         string;
  agentId:    string;
  chatId:     string;
  authorId:   string;
  input:      string;
  output:     string | null;
  decision:   string;
  modelUsed:  string | null;
  success:    boolean;
  durationMs: number | null;
  createdAt:  string;
  classification?: {
    intent:        string;
    priority:      string;
    isHotLead:     boolean;
    requiresHuman: boolean;
    confidence:    number;
  } | null;
}

// ── Query keys ────────────────────────────────────────────────────────────────

const AVITO_ACCOUNTS_KEY      = ["avito-accounts"]      as const;
const AVITO_CONVERSATIONS_KEY = ["avito-conversations"]  as const;
const AVITO_AUDIT_KEY         = ["avito-audit"]          as const;
const AVITO_STATUS_KEY        = ["avito-status"]         as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAvitoAccounts() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: AVITO_ACCOUNTS_KEY,
    queryFn:  () => apiClient.get<AvitoAccount[]>("/avito/accounts"),
    enabled:  Boolean(accessToken),
    staleTime: 10_000,
  });
}

export function useCreateAvitoAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAvitoAccountInput) =>
      apiClient.post<AvitoAccount>("/avito/accounts", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AVITO_ACCOUNTS_KEY });
      void qc.invalidateQueries({ queryKey: AVITO_STATUS_KEY });
    },
  });
}

export function usePatchAvitoAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & PatchAvitoAccountInput) =>
      apiClient.patch<AvitoAccount>(`/avito/accounts/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AVITO_ACCOUNTS_KEY });
      void qc.invalidateQueries({ queryKey: AVITO_STATUS_KEY });
    },
  });
}

export function useDeleteAvitoAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/avito/accounts/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AVITO_ACCOUNTS_KEY });
      void qc.invalidateQueries({ queryKey: AVITO_STATUS_KEY });
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function usePatchAvitoAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      avitoMode,
      avitoAccountId,
    }: {
      agentId:         string;
      avitoMode?:      string;
      avitoAccountId?: string | null;
    }) =>
      apiClient.patch<{ id: string; avitoMode: string; avitoAccountId: string | null }>(
        `/avito/agent/${agentId}`,
        { avitoMode, avitoAccountId }
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useAvitoStatus() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { data: accounts } = useAvitoAccounts();
  return useQuery({
    queryKey: AVITO_STATUS_KEY,
    queryFn: async () => {
      // Status = connected if ≥1 active account with credentials
      const active = accounts?.filter((a) => a.isActive && a.hasToken);
      if (active && active.length > 0) return "connected" as const;
      // Fallback: ping /avito/chats with env-based credentials
      try {
        await apiClient.get("/avito/chats");
        return "connected" as const;
      } catch {
        return "disconnected" as const;
      }
    },
    enabled: Boolean(accessToken) && accounts !== undefined,
    staleTime: 30_000,
    retry: false,
  });
}

export function useAvitoConversations() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: AVITO_CONVERSATIONS_KEY,
    queryFn:  () => apiClient.get<AvitoConversation[]>("/avito/conversations"),
    enabled:  Boolean(accessToken),
    staleTime: 15_000,
  });
}

export function useAvitoAudit() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: AVITO_AUDIT_KEY,
    queryFn:  () => apiClient.get<AvitoAuditLog[]>("/avito/audit"),
    enabled:  Boolean(accessToken),
    staleTime: 15_000,
  });
}

// ── Diagnostic hooks ──────────────────────────────────────────────────────────

export interface AvitoSyncResult {
  ok:          boolean;
  accountId:   string;
  chatsCount:  number | null;
  chats:       unknown[];
}

export interface AvitoTokenCheckResult {
  ok:          boolean;
  status:      string;
  message:     string;
  accountId?:  string;
  chatsCount?: number | null;
}

export interface AvitoDialogsResult {
  db: {
    count:         number;
    conversations: AvitoConversation[];
  };
  avito: {
    count: number | null;
    chats: unknown[];
  } | null;
  apiError: string | null;
}

export interface AvitoTestSendResult {
  ok:     boolean;
  chatId: string;
  text:   string;
  result: unknown;
}

export function useAvitoSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post<AvitoSyncResult>("/avito/sync"),
    onSuccess:  () => void qc.invalidateQueries({ queryKey: AVITO_CONVERSATIONS_KEY }),
  });
}

export function useAvitoTokenCheck() {
  return useMutation({
    mutationFn: () => apiClient.get<AvitoTokenCheckResult>("/avito/token-check"),
  });
}

export function useAvitoDialogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.get<AvitoDialogsResult>("/avito/dialogs"),
    onSuccess:  () => void qc.invalidateQueries({ queryKey: AVITO_CONVERSATIONS_KEY }),
  });
}

export function useAvitoTestSend() {
  return useMutation({
    mutationFn: (body: { chatId: string; text?: string }) =>
      apiClient.post<AvitoTestSendResult>("/avito/test-send", body),
  });
}
