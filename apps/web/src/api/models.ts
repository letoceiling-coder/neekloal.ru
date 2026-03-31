import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys";
import { apiClient } from "../lib/apiClient";

// API returns { models: string[] } or { models: { name: string }[] } depending on Ollama version
export type ModelItem = string | { name: string; size?: number; modified_at?: string };
export type ModelsResponse = { models: ModelItem[] };

export async function fetchModels(): Promise<string[]> {
  const r = await apiClient.get<ModelsResponse>("/models");
  return (r.models ?? []).map((m) =>
    typeof m === "string" ? m : (m.name ?? String(m))
  );
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models.names,
    queryFn: fetchModels,
    staleTime: 5 * 60 * 1000,
  });
}
