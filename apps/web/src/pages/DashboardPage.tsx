import { useUsage } from "../api/usage";

export function DashboardPage() {
  const { data, isLoading, isError, error } = useUsage();

  return (
    <div className="space-y-6 transition-all duration-200 ease-out">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          Дашборд
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Сводка использования API по вашему ключу.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-neutral-500 transition-all duration-200">
          Загрузка…
        </p>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 transition-all duration-200">
          {error instanceof Error ? error.message : "Не удалось загрузить данные"}
        </div>
      )}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Запросов всего
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
              {data.totalRequests}
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
              Токенов всего
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-neutral-900">
              {data.totalTokens}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
