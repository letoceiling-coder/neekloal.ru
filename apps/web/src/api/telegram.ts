import { apiClient } from "../lib/apiClient";

export type ConnectTelegramResponse = {
  ok: true;
  botId: string;
  botUsername: string | null;
  webhookUrl: string;
};

/**
 * POST /telegram/connect (через apiClient: база = /api).
 */
export function connectTelegram(botToken: string) {
  return apiClient.post<ConnectTelegramResponse>("/telegram/connect", {
    botToken: botToken.trim(),
  });
}
