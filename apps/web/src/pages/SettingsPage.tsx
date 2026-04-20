import { useEffect, useMemo, useState } from "react";
import {
  type BillingUsageHistoryItem,
  useBillingSummary,
} from "../api/billing";
import {
  useNotificationSettings,
  useUpdateNotificationSettings,
  useTestNotification,
} from "../api/notificationSettings";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Input,
  Loader,
  Page,
} from "../components/ui";

function formatReset(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatLimit(n: number | null): string {
  if (n == null) {
    return "Без лимита";
  }
  return n.toLocaleString("ru-RU");
}

// ─── Telegram notification settings block ────────────────────────────────────

function NotificationSettingsSection() {
  const { data, isLoading, error, refetch } = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const test   = useTestNotification();

  const [chatId,     setChatId]     = useState("");
  const [botToken,   setBotToken]   = useState("");
  const [enabled,    setEnabled]    = useState(true);
  const [onNewLead,  setOnNewLead]  = useState(true);
  const [onHandoff,  setOnHandoff]  = useState(true);
  const [onHotLead,  setOnHotLead]  = useState(true);
  const [saved,      setSaved]      = useState(false);
  const [testOk,     setTestOk]     = useState<string | null>(null);
  const [testErr,    setTestErr]    = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setChatId(s.tgManagerChatId);
    setEnabled(s.tgManagerEnabled);
    setOnNewLead(s.notifyOnNewLead);
    setOnHandoff(s.notifyOnHandoff);
    setOnHotLead(s.notifyOnHotLead);
    // botToken поле всегда стартует пустым — редактор, а не показ
    setBotToken("");
  }, [data]);

  const tokenSet = Boolean(data?.settings.tgManagerBotTokenSet);
  const ready    = Boolean(data?.effective.telegramReady);
  const source   = data?.effective.source ?? "none";

  async function handleSave() {
    setSaved(false);
    const payload: Parameters<typeof update.mutateAsync>[0] = {
      tgManagerChatId: chatId.trim() || null,
      tgManagerEnabled: enabled,
      notifyOnNewLead: onNewLead,
      notifyOnHandoff: onHandoff,
      notifyOnHotLead: onHotLead,
    };
    if (botToken.trim() !== "") {
      payload.tgManagerBotToken = botToken.trim();
    }
    await update.mutateAsync(payload);
    setBotToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleClearToken() {
    if (!window.confirm("Удалить Bot Token? Канал перестанет работать до следующего сохранения.")) return;
    await update.mutateAsync({ tgManagerBotToken: null });
    setBotToken("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleTest() {
    setTestOk(null);
    setTestErr(null);
    try {
      const r = await test.mutateAsync(undefined);
      if (r.ok) {
        setTestOk(`Отправлено (источник: ${r.source})`);
      } else {
        setTestErr(r.error);
      }
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : "Не удалось отправить");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-neutral-900">Уведомления менеджеру (Telegram)</p>
            <p className="text-xs text-neutral-500">
              Алерты о новых лидах, HANDOFF и горячих клиентах — летят в указанный чат.
            </p>
          </div>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs font-medium",
              ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
            ].join(" ")}
            title={
              source === "db"
                ? "Используются настройки из админки"
                : source === "env"
                  ? "Используется fallback из переменных окружения (LEAD_NOTIFY_*)"
                  : "Telegram не настроен"
            }
          >
            {ready ? `готово · ${source}` : "не настроено"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="border-t border-neutral-100 pt-4 space-y-4">
        {isLoading ? (
          <Loader />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Ошибка загрузки"}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  id="tg-bot-token"
                  label={`Bot Token${tokenSet ? " (задан, оставьте пустым, чтобы не менять)" : ""}`}
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={tokenSet ? "••••••••:••••••••••••••••••••••••" : "123456:ABC-DEF…"}
                  autoComplete="off"
                />
                {tokenSet && (
                  <button
                    type="button"
                    onClick={() => void handleClearToken()}
                    className="mt-1 text-[11px] text-red-600 underline underline-offset-2"
                  >
                    Удалить сохранённый токен
                  </button>
                )}
              </div>
              <Input
                id="tg-chat-id"
                label="Chat ID"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="-1001234567890 или 123456789"
              />
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-neutral-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Канал включён
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onNewLead}
                  onChange={(e) => setOnNewLead(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Новый лид
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onHandoff}
                  onChange={(e) => setOnHandoff(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                HANDOFF (передача менеджеру)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onHotLead}
                  onChange={(e) => setOnHotLead(e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                Горячий лид
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="button"
                onClick={() => void handleSave()}
                loading={update.isPending}
              >
                Сохранить
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleTest()}
                loading={test.isPending}
                disabled={!ready && botToken.trim() === ""}
              >
                Отправить тестовое сообщение
              </Button>
              {saved   && <span className="text-sm text-emerald-600">✓ Сохранено</span>}
              {testOk  && <span className="text-sm text-emerald-600">✓ {testOk}</span>}
              {testErr && <span className="text-sm text-red-600">✗ {testErr}</span>}
            </div>

            <p className="text-xs text-neutral-500 leading-relaxed">
              Настройки применяются ко всей организации. Если поля пустые — используются
              переменные окружения сервера (fallback для старых инсталляций).
              Токен хранится в БД и наружу не отдаётся — при редактировании поле всегда пустое.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { data, isLoading, error, refetch } = useBillingSummary();

  const historyColumns = useMemo<DataTableColumn<BillingUsageHistoryItem>[]>(
    () => [
      {
        id: "time",
        header: "Время",
        cell: (r) => (
          <span className="text-xs text-neutral-500">{formatReset(r.createdAt)}</span>
        ),
      },
      {
        id: "model",
        header: "Модель",
        cell: (r) => <span className="font-mono text-xs">{r.model}</span>,
      },
      {
        id: "tokens",
        header: "Токены",
        cell: (r) => r.tokens.toLocaleString("ru-RU"),
      },
      {
        id: "conv",
        header: "Диалог",
        className: "max-w-[120px] truncate",
        cell: (r) => (
          <span className="font-mono text-[10px] text-neutral-500" title={r.conversationId ?? ""}>
            {r.conversationId ? `${r.conversationId.slice(0, 8)}…` : "—"}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <Page
      title="Настройки"
      description="Тариф, лимиты, защита от перегрузки и последние списания токенов."
    >
      {isLoading ? (
        <Loader />
      ) : error ? (
        <ErrorState
          message={
            error instanceof Error
              ? `Не удалось загрузить биллинг: ${error.message}`
              : "Не удалось загрузить биллинг"
          }
          onRetry={() => void refetch()}
        />
      ) : data ? (
        <div className="space-y-6">
          <NotificationSettingsSection />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="sm:col-span-2 lg:col-span-3">
              <CardHeader>
                <p className="text-sm font-semibold text-neutral-900">Текущий план</p>
                <p className="text-xs text-neutral-500">
                  {data.organization.name} · {data.organization.slug}
                </p>
              </CardHeader>
              <CardContent className="border-t border-neutral-100 pt-4">
                <p className="text-lg font-semibold text-neutral-900">{data.plan.name}</p>
                <p className="text-sm text-neutral-500">Код: {data.plan.slug}</p>
                <p className="mt-3 text-xs text-neutral-500">
                  Сброс периода: {formatReset(data.period.resetAt)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Запросы за период
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                  {data.usage.requestsUsed.toLocaleString("ru-RU")}
                  <span className="text-base font-normal text-neutral-400">
                    {" "}
                    / {formatLimit(data.plan.maxRequestsPerMonth)}
                  </span>
                </p>
                {data.usage.requestsRemaining != null ? (
                  <p className="mt-2 text-sm text-emerald-700">
                    Остаток: {data.usage.requestsRemaining.toLocaleString("ru-RU")}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-neutral-500">Остаток не ограничен</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Токены за период
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                  {data.usage.tokensUsed.toLocaleString("ru-RU")}
                  <span className="text-base font-normal text-neutral-400">
                    {" "}
                    / {formatLimit(data.plan.maxTokensPerMonth)}
                  </span>
                </p>
                {data.usage.tokensRemaining != null ? (
                  <p className="mt-2 text-sm text-emerald-700">
                    Остаток: {data.usage.tokensRemaining.toLocaleString("ru-RU")}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-neutral-500">Остаток не ограничен</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Лимиты стабильности
                </p>
                <ul className="mt-2 space-y-1.5 text-sm text-neutral-700">
                  <li>
                    Follow-up на диалог:{" "}
                    <span className="font-semibold tabular-nums text-neutral-900">
                      ≤ {data.limits.maxFollowUpsPerConversation}
                    </span>
                  </li>
                  <li>
                    Уведомлений о лидах / орг / час:{" "}
                    <span className="font-semibold tabular-nums text-neutral-900">
                      ≤ {data.limits.leadNotifyMaxPerOrgPerHour}
                    </span>
                  </li>
                </ul>
                <p className="mt-3 text-xs text-neutral-500">
                  Фактические пороги задаются на сервере (env). Здесь — эффективные значения.
                </p>
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              Последние списания (usage)
            </h3>
            <DataTable
              columns={historyColumns}
              rows={data.usageHistory}
              getRowId={(r) => r.id}
              emptyTitle="Записей usage пока нет"
              emptyDescription="После запросов к чату здесь появятся строки списания."
            />
          </div>
        </div>
      ) : null}
    </Page>
  );
}
