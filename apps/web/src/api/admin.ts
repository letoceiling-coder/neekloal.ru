import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type AdminPlan = {
  id: string;
  slug: string;
  name: string;
  maxRequestsPerMonth: number | null;
  maxTokensPerMonth: number | null;
  allowedModels: unknown;
  createdAt: string;
  updatedAt: string;
};

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  planId: string;
  requestsUsed: number;
  tokensUsed: number;
  resetAt: string;
  isBlocked: boolean;
  createdAt: string;
  updatedAt: string;
  plan: AdminPlan;
};

export type AdminUserRow = {
  id: string;
  email: string;
  role: "user" | "admin" | "root";
  createdAt: string;
  updatedAt: string;
};

export type AdminUsageItem = {
  id: string;
  organizationId: string;
  userId: string | null;
  model: string;
  tokens: number;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  user: { id: string; email: string } | null;
};

export type AdminUsageResponse = {
  items: AdminUsageItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminLeadConversationBrief = {
  id: string;
  status: string;
  source: string;
  createdAt: string;
};

export type AdminLeadListRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  firstMessage: string | null;
  createdAt: string;
  organization: { id: string; name: string; slug: string };
  conversations: AdminLeadConversationBrief[];
};

export type AdminLeadMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export type AdminLeadConversationDetail = {
  id: string;
  status: string;
  source: string;
  createdAt: string;
  messages: AdminLeadMessage[];
};

export type AdminLeadDetail = Omit<AdminLeadListRow, "conversations"> & {
  conversations: AdminLeadConversationDetail[];
};

export type OrganizationPatch = {
  name?: string;
  planId?: string;
  isBlocked?: boolean;
  requestsUsed?: number;
  tokensUsed?: number;
  resetAt?: string;
};

export type UserPatch = {
  email?: string;
  role?: "user" | "admin" | "root";
};

export type PlanPatch = {
  name?: string;
  maxRequestsPerMonth?: number | null;
  maxTokensPerMonth?: number | null;
  allowedModels?: unknown;
};

export async function getOrganizations(): Promise<AdminOrganization[]> {
  return apiClient.get<AdminOrganization[]>("/admin/organizations");
}

export async function updateOrganization(
  id: string,
  body: OrganizationPatch
): Promise<AdminOrganization> {
  return apiClient.patch<AdminOrganization>(`/admin/organizations/${id}`, body);
}

export async function getUsers(): Promise<AdminUserRow[]> {
  return apiClient.get<AdminUserRow[]>("/admin/users");
}

export async function updateUser(id: string, body: UserPatch): Promise<AdminUserRow> {
  return apiClient.patch<AdminUserRow>(`/admin/users/${id}`, body);
}

export async function getPlans(): Promise<AdminPlan[]> {
  return apiClient.get<AdminPlan[]>("/admin/plans");
}

export async function updatePlan(id: string, body: PlanPatch): Promise<AdminPlan> {
  return apiClient.patch<AdminPlan>(`/admin/plans/${id}`, body);
}

export type AdminUsageFilters = {
  organizationId?: string;
  model?: string;
};

export async function getUsage(
  limit: number,
  offset: number,
  filters?: AdminUsageFilters
): Promise<AdminUsageResponse> {
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const orgId = filters?.organizationId?.trim();
  const model = filters?.model?.trim();
  if (orgId) q.set("organizationId", orgId);
  if (model) q.set("model", model);
  return apiClient.get<AdminUsageResponse>(`/admin/usage?${q.toString()}`);
}

export async function getAdminLeads(): Promise<AdminLeadListRow[]> {
  return apiClient.get<AdminLeadListRow[]>("/admin/leads");
}

export async function getAdminLead(id: string): Promise<AdminLeadDetail> {
  return apiClient.get<AdminLeadDetail>(`/admin/leads/${encodeURIComponent(id)}`);
}

export function useAdminOrganizations() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.admin.organizations,
    queryFn: getOrganizations,
    enabled: Boolean(accessToken),
  });
}

export function useAdminUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OrganizationPatch }) =>
      updateOrganization(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.organizations });
    },
  });
}

export function useAdminUsers() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.admin.users,
    queryFn: getUsers,
    enabled: Boolean(accessToken),
  });
}

export function useAdminUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UserPatch }) => updateUser(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.users });
    },
  });
}

export function useAdminPlans() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.admin.plans,
    queryFn: getPlans,
    enabled: Boolean(accessToken),
  });
}

export function useAdminUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PlanPatch }) => updatePlan(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.admin.plans });
      void qc.invalidateQueries({ queryKey: queryKeys.admin.organizations });
    },
  });
}

export function useAdminUsage(
  limit: number,
  offset: number,
  filters?: AdminUsageFilters
) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const organizationId = filters?.organizationId?.trim() ?? "";
  const model = filters?.model?.trim() ?? "";
  return useQuery({
    queryKey: queryKeys.admin.usage(limit, offset, organizationId, model),
    queryFn: () => getUsage(limit, offset, filters),
    enabled: Boolean(accessToken),
  });
}

export function useAdminLeads() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: queryKeys.admin.leads,
    queryFn: getAdminLeads,
    enabled: Boolean(accessToken),
  });
}

export function useAdminLead(id: string | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: id ? queryKeys.admin.lead(id) : ["admin", "leads", "none"],
    queryFn: () => getAdminLead(id as string),
    enabled: Boolean(accessToken && id),
  });
}
