import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type KnowledgeItem = {
  id: string;
  assistantId: string;
  type: "text" | "file" | "url";
  sourceName: string | null;
  status: "processing" | "ready" | "failed";
  /** Intent label assigned at ingest time: "pricing" | "objection" | "qualification_site" | "close" | null */
  intent: string | null;
  contentPreview: string;
  chunkCount: number;
  createdAt: string;
  updatedAt?: string;
};

export type AddKnowledgeInput = {
  assistantId: string;
  content: string;
};

export function useKnowledgeList(assistantId: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: assistantId
      ? queryKeys.knowledge.byAssistant(assistantId)
      : queryKeys.knowledge.all,
    queryFn: () =>
      apiClient.get<KnowledgeItem[]>(
        `/knowledge${assistantId ? `?assistantId=${assistantId}` : ""}`
      ),
    enabled: Boolean(accessToken) && Boolean(assistantId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.some((item) => item.status === "processing")) {
        return 3000;
      }
      return false;
    },
  });
}

export function useAddKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddKnowledgeInput) =>
      apiClient.post<KnowledgeItem>("/knowledge", body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.byAssistant(variables.assistantId),
      });
    },
  });
}

export function useAddKnowledgeUrl(assistantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { assistantId: string; url: string }) =>
      apiClient.post<KnowledgeItem>("/knowledge/url", body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.byAssistant(assistantId),
      });
    },
  });
}

export function useDeleteKnowledge(assistantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ ok: boolean }>(`/knowledge/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.byAssistant(assistantId),
      });
    },
  });
}

export type KnowledgeItemFull = KnowledgeItem & { content: string };

export function useGetKnowledge() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.get<KnowledgeItemFull>(`/knowledge/${id}`),
  });
}

export type PatchKnowledgeInput = {
  id: string;
  assistantId: string;
  content?: string;
  intent?: string | null;
};

export function usePatchKnowledge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchKnowledgeInput) =>
      apiClient.patch<KnowledgeItem>(`/knowledge/${id}`, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.byAssistant(variables.assistantId),
      });
    },
  });
}

export type KnowledgeUploadBatchResult = {
  items: KnowledgeItem[];
  errors: { sourceName: string; error: string }[];
};

function knowledgeUploadBaseUrl(): string {
  return import.meta.env.VITE_API_URL != null &&
    String(import.meta.env.VITE_API_URL).trim() !== ""
    ? String(import.meta.env.VITE_API_URL).replace(/\/$/, "")
    : `${window.location.origin}/api`;
}

/**
 * Upload one or many files (multipart: assistantId + files[]).
 */
export async function uploadKnowledgeFiles(
  assistantId: string,
  files: File[],
  token: string | null
): Promise<KnowledgeUploadBatchResult> {
  const base = knowledgeUploadBaseUrl();
  const formData = new FormData();
  formData.append("assistantId", assistantId);
  for (const file of files) {
    formData.append("files[]", file);
  }

  const res = await fetch(`${base}/knowledge/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  const body = (await res.json().catch(() => ({}))) as KnowledgeUploadBatchResult & {
    error?: string;
  };

  if (!res.ok) {
    const errMsg =
      typeof body === "object" && body !== null && "error" in body && body.error
        ? String(body.error)
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return {
    items: Array.isArray(body.items) ? body.items : [],
    errors: Array.isArray(body.errors) ? body.errors : [],
  };
}

/**
 * Upload a single file (legacy); uses batch API under the hood.
 */
export async function uploadKnowledgeFile(
  assistantId: string,
  file: File,
  token: string | null
): Promise<KnowledgeItem> {
  const { items, errors } = await uploadKnowledgeFiles(assistantId, [file], token);
  if (items.length > 0) return items[0];
  if (errors.length > 0) throw new Error(errors[0].error);
  throw new Error("Upload failed");
}
