import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../queryKeys";
import { apiClient } from "../lib/apiClient";

export type ModelsResponse = { models: string[] };

export async function fetchModels(): Promise<string[]> {
  const r = await apiClient.get<ModelsResponse>("/models");
  return r.models ?? [];
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models.all,
    queryFn: fetchModels,
    staleTime: 5 * 60 * 1000,
  });
}
