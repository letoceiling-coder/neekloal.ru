import { type FormEvent, useEffect, useState } from "react";
import { connectTelegram, disconnectTelegram } from "../api/telegram";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Page,
} from "../components/ui";
import { ApiError } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";

const STORAGE_PREFIX = "telegram_bot_ui_v1";

function storageKey(userId: string | null, organizationId: string | null): string | null {
  if (!userId || !organizationId) return null;
  return `${STORAGE_PREFIX}:${organizationId}:${userId}`;
}

type SavedOk = {
  kind: "ok";
  botId: string;
  botUsername: string | null;
  webhookUrl: string;
};

function readSaved(key: string | null): SavedOk | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p.kind !== "ok" || typeof p.botId !== "string") return null;
    return {
      kind: "ok",
      botId: p.botId,
      botUsername: typeof p.botUsername === "string" || p.botUsername === null ? (p.botUsername as string | null) : null,
      webhookUrl: typeof p.webhookUrl === "string" ? p.webhookUrl : "",
    };
  } catch {
    return null;
  }
}

function writeSaved(key: string | null, data: SavedOk) {
  if (!key || typeof window === "undefined") return;
  sessionStorage.setItem(key, JSON.stringify(data));
}

function clearSaved(key: string | null) {
  if (!key || typeof window === "undefined") return;
  sessionStorage.removeItem(key);
}

export function TelegramPage() {
  const userId = useAuthStore((s) => s.userId);
  const organizationId = useAuthStore((s) => s.organizationId);
  const key = storageKey(userId, organizationId);

  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<SavedOk | null>(null);
  const [alreadyConnected, setAlreadyConnected] = useState(false);

  useEffect(() => {
    const saved = readSaved(key);
    if (saved) setConnected(saved);
  }, [key]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token.trim()) {
      setError("Введите токен бота.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await connectTelegram(token.trim());
      const next: SavedOk = {
        kind: "ok",
        botId: res.botId,
        botUsername: res.botUsername,
        webhookUrl: res.webhookUrl,
      };
      setConnected(next);
      writeSaved(key, next);
      setToken("");
      setAlreadyConnected(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAlreadyConnected(true);
        setToken("");
        setConnected(null);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Не удалось подключить бота.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      await disconnectTelegram();
      setConnected(null);
      setAlreadyConnected(false);
      clearSaved(key);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setConnected(null);
        setAlreadyConnected(false);
        clearSaved(key);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Не удалось отключить бота.");
    } finally {
      setDisconnecting(false);
    }
  }

  const disabled = alreadyConnected || Boolean(connected);
  const actionBusy = submitting || disconnecting;

  return (
    <Page
      className="mx-auto max-w-xl"
      title="Telegram Bot"
      description="Подключите бота через токен от @BotFather. После подключения webhook задаётся автоматически."
    >
      <Card>
        <CardHeader>
          <p className="text-sm font-semibold text-neutral-900">Подключение</p>
          <p className="text-xs text-neutral-500">
            Токен передаётся только на ваш сервер и не сохраняется в браузере.
          </p>
        </CardHeader>
        <CardContent className="border-t border-neutral-100 pt-4">
          {connected ? (
            <div className="space-y-3 rounded-md border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900">
              <p className="font-medium">Бот подключен</p>
              {connected.botUsername ? (
                <p>
                  <span className="text-emerald-700">@{connected.botUsername}</span>
                </p>
              ) : null}
              <p className="break-all text-xs text-emerald-800/90">
                ID: <span className="font-mono">{connected.botId}</span>
              </p>
            </div>
          ) : null}

          {alreadyConnected ? (
            <div className="mb-4 space-y-2 rounded-md border border-amber-100 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">Бот уже подключен</p>
              <p className="text-xs text-amber-900/90">
                Для этой учётной записи уже зарегистрирован Telegram-бот. Повторное подключение не требуется.
              </p>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="telegram-bot-token" className="sr-only">
                Bot Token
              </label>
              <Input
                id="telegram-bot-token"
                name="botToken"
                type="password"
                autoComplete="off"
                placeholder="Bot Token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={disabled || actionBusy}
                className="font-mono text-sm"
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={disabled || actionBusy || !token.trim()}>
              {submitting ? "Подключение…" : "Подключить"}
            </Button>

            {(connected || alreadyConnected) && (
              <Button
                type="button"
                variant="secondary"
                disabled={actionBusy}
                onClick={handleDisconnect}
              >
                {disconnecting ? "Отключение…" : "Отключить и привязать новый токен"}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </Page>
  );
}
