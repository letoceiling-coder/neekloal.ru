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

/**
 * Upload a file to POST /knowledge/upload (multipart).
 * Returns a KnowledgeItem in processing state.
 */
export async function uploadKnowledgeFile(
  assistantId: string,
  file: File,
  token: string | null
): Promise<KnowledgeItem> {
  const base =
    import.meta.env.VITE_API_URL != null &&
    String(import.meta.env.VITE_API_URL).trim() !== ""
      ? String(import.meta.env.VITE_API_URL).replace(/\/$/, "")
      : `${window.location.origin}/api`;

  const formData = new FormData();
  formData.append("assistantId", assistantId);
  formData.append("file", file);

  const res = await fetch(`${base}/knowledge/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const errMsg =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }

  return res.json() as Promise<KnowledgeItem>;
}
