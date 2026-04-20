import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { queryKeys } from "../queryKeys";
import { useAuthStore } from "../stores/authStore";

export type NotificationSettings = {
  /** Токен сам по себе не отдаётся — только флаг, задан ли он */
  tgManagerBotTokenSet: boolean;
  tgManagerChatId: string;
  tgManagerEnabled: boolean;
  notifyOnNewLead: boolean;
  notifyOnHandoff: boolean;
  notifyOnHotLead: boolean;
  emailEnabled: boolean;
  emailRecipients: string;
  updatedAt: string | null;
};

export type NotificationSettingsResponse = {
  settings: NotificationSettings;
  effective: {
    telegramReady: boolean;
    source: "db" | "env" | "none";
  };
};

export type UpdateNotificationSettingsInput = {
  /** `null` — очистить токен; пустая строка / `undefined` — не трогать */
  tgManagerBotToken?: string | null;
  tgManagerChatId?: string | null;
  tgManagerEnabled?: boolean;
  notifyOnNewLead?: boolean;
  notifyOnHandoff?: boolean;
  notifyOnHotLead?: boolean;
  emailEnabled?: boolean;
  emailRecipients?: string | null;
};

export function useNotificationSettings() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery<NotificationSettingsResponse>({
    queryKey: queryKeys.notificationSettings.all,
    queryFn: () => apiClient.get<NotificationSettingsResponse>("/notification-settings"),
    enabled: Boolean(accessToken),
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationSettingsInput) =>
      apiClient.put<NotificationSettingsResponse>("/notification-settings", body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.notificationSettings.all, data);
    },
  });
}

export type TestNotificationResult =
  | { ok: true; source: "db" | "env" | "none" }
  | { ok: false; error: string; source: "db" | "env" | "none" };

export function useTestNotification() {
  return useMutation({
    mutationFn: (text?: string) =>
      apiClient.post<TestNotificationResult>("/notification-settings/test", { text }),
  });
}
