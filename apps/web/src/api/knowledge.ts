import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";

export type KnowledgeItem = {
  id: string;
  assistantId: string;
  type: string;
  content: string;
  createdAt?: string;
};

export type AddKnowledgeInput = {
  assistantId: string;
  content: string;
};

export function useAddKnowledge() {
  return useMutation({
    mutationFn: (body: AddKnowledgeInput) =>
      apiClient.post<KnowledgeItem>("/knowledge", body),
  });
}
