import { useUsage } from "../api/usage";
import { Card, CardContent, Loader, Page } from "../components/ui";

export function DashboardPage() {
  const { data, isLoading, isError, error } = useUsage();

  return (
    <Page
      title="Дашборд"
      description="Сводка использования API по вашему ключу."
    >
      {isLoading ? <Loader /> : null}

      {isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 transition-all duration-200">
          {error instanceof Error
            ? error.message
            : "Не удалось загрузить данные"}
        </div>
      ) : null}

      {data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Запросов всего
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                {data.totalRequests}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                Токенов всего
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
                {data.totalTokens}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </Page>
  );
}
