import React, { useState } from "react";
import { ExternalLink, Loader2, Plug } from "lucide-react";
import { Card, CardContent, CardHeader } from "../components/ui";
import {
  useIntegrations,
  useUpdateIntegration,
  type AiProviderId,
  type IntegrationRow,
  type UpdateIntegrationInput,
} from "../api/integrations";

const PROVIDER_META: Record<
  AiProviderId,
  { title: string; docsUrl: string; note: string }
> = {
  openai: {
    title: "OpenAI",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    note: "Чат: модели вида openai/gpt-4o-mini в списке моделей после сохранения ключа.",
  },
  anthropic: {
    title: "Anthropic (Claude)",
    docsUrl: "https://docs.claude.com/en/api/overview",
    note: "Список моделей Claude подгружается из актуального каталога (см. документацию).",
  },
  google: {
    title: "Google AI Studio (Gemini)",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    note: "Используйте API key из Google AI Studio; в каталоге — модели с generateContent.",
  },
  xai: {
    title: "xAI (Grok)",
    docsUrl: "https://docs.x.ai/docs/overview",
    note: "Совместимый с OpenAI chat/completions API; модели вида xai/grok-…",
  },
  replicate: {
    title: "Replicate",
    docsUrl: "https://replicate.com/docs/reference/http",
    note: "В каталоге — примеры моделей; текстовый чат агентов через Replicate пока не подключён (только учёт ключа и список).",
  },
  elevenlabs: {
    title: "ElevenLabs",
    docsUrl: "https://elevenlabs.io/docs/api-reference",
    note: "Озвучивание (TTS). Модели в общем списке с префиксом elevenlabs/ — для чата агентов не используются.",
  },
};

function IntegrationCard({
  row,
  onSave,
  busy,
}: {
  row: IntegrationRow;
  onSave: (p: AiProviderId, apiKey: string | null | "__CLEAR__", isEnabled: boolean) => Promise<void>;
  busy: boolean;
}) {
  const meta = PROVIDER_META[row.provider];
  const [key, setKey]     = useState("");
  const [enabled, setEn]  = useState(row.isEnabled);
  const [err, setErr]     = useState<string | null>(null);

  React.useEffect(() => {
    setEn(row.isEnabled);
  }, [row.isEnabled]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const trimmed = key.trim();
    try {
      await onSave(row.provider, trimmed || null, enabled);
      setKey("");
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{meta.title}</h2>
            <p className="mt-1 text-[11px] text-neutral-500">{meta.note}</p>
          </div>
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
          >
            Документация
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEn(e.target.checked)}
              className="rounded border-neutral-300"
            />
            Включить интеграцию
          </label>
          <div>
            <p className="mb-1 text-[11px] font-medium text-neutral-500">API ключ</p>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={row.apiKeySet ? "Оставьте пустым, чтобы не менять ключ" : "Вставьте ключ"}
              className="w-full rounded-md border border-neutral-200 px-3 py-2 text-xs placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
            />
            {row.apiKeySet && (
              <p className="mt-1 text-[10px] text-neutral-400">
                Сохранённый ключ: {row.apiKeyHint ?? "установлен"}
              </p>
            )}
          </div>
          {err && (
            <p className="text-[11px] text-red-600">{err}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Сохранить
            </button>
            {row.apiKeySet && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void (async () => {
                  setErr(null);
                  try {
                    await onSave(row.provider, "__CLEAR__", false);
                    setEn(false);
                  } catch (err) {
                    setErr(err instanceof Error ? err.message : "Ошибка");
                  }
                })()}
                className="text-[11px] text-red-600 hover:underline disabled:opacity-50"
              >
                Удалить ключ
              </button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function IntegrationsPage() {
  const { data, isLoading, error } = useIntegrations();
  const update = useUpdateIntegration();
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  async function onSave(
    provider: AiProviderId,
    apiKey: string | null | "__CLEAR__",
    isEnabled: boolean
  ) {
    setGlobalErr(null);
    const body: UpdateIntegrationInput = { isEnabled };
    if (apiKey === "__CLEAR__") body.apiKey = null;
    else if (apiKey !== null && apiKey.trim()) body.apiKey = apiKey.trim();
    await update.mutateAsync({ provider, body });
  }

  const rows = data?.integrations ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
          <Plug className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Интеграции AI</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Подключение облачных провайдеров по API. Ключи хранятся на сервере и не показываются целиком.
            После сохранения модели появятся в общем списке{" "}
            <span className="font-medium">GET /models</span> (страницы ассистентов и агентов).
          </p>
          <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Не публикуйте API-ключи в чатах и скриншотах. Если ключ уже засветился — отзовите его в кабинете
            провайдера и создайте новый здесь.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      )}
      {error && (
        <p className="text-sm text-red-600">
          {(error as Error).message || "Не удалось загрузить интеграции"}
        </p>
      )}
      {globalErr && <p className="text-sm text-red-600">{globalErr}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <IntegrationCard
            key={row.provider}
            row={row}
            onSave={onSave}
            busy={update.isPending}
          />
        ))}
      </div>
    </div>
  );
}
