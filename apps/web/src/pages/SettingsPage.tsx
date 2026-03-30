import { useMemo } from "react";
import {
  type BillingUsageHistoryItem,
  useBillingSummary,
} from "../api/billing";
import {
  Card,
  CardContent,
  CardHeader,
  DataTable,
  type DataTableColumn,
  ErrorState,
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
