import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type BillingUsageHistoryItem = {
  id: string;
  model: string;
  tokens: number;
  createdAt: string;
  conversationId: string | null;
  cost: string | null;
};

export type BillingSummary = {
  organization: { name: string; slug: string };
  plan: {
    name: string;
    slug: string;
    maxRequestsPerMonth: number | null;
    maxTokensPerMonth: number | null;
  };
  period: { resetAt: string };
  usage: {
    requestsUsed: number;
    tokensUsed: number;
    requestsRemaining: number | null;
    tokensRemaining: number | null;
  };
  limits: {
    maxFollowUpsPerConversation: number;
    leadNotifyMaxPerOrgPerHour: number;
  };
  usageHistory: BillingUsageHistoryItem[];
};

export async function getBillingSummary(usageHistoryLimit?: number): Promise<BillingSummary> {
  const q =
    usageHistoryLimit != null && Number.isFinite(usageHistoryLimit)
      ? `?usageHistoryLimit=${encodeURIComponent(String(Math.floor(usageHistoryLimit)))}`
      : "";
  return apiClient.get<BillingSummary>(`/billing/summary${q}`);
}

export function useBillingSummary() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<BillingSummary>({
    queryKey: queryKeys.billing.summary,
    queryFn: () => getBillingSummary(),
    enabled: Boolean(accessToken),
  });
}
