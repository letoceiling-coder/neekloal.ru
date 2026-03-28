import { useConversations } from "../api/conversations";

export function ConversationsPage() {
  const { data, isLoading, isError, error } = useConversations();

  return (
    <div className="space-y-6 transition-all duration-200 ease-out">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          Диалоги
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Список разговоров с API.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-neutral-500">Загрузка…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error instanceof Error
            ? error.message
            : "Не удалось загрузить диалоги. Убедитесь, что на бэкенде есть маршрут GET /conversations."}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-neutral-500">Диалогов пока нет.</p>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm transition-all duration-200"
            >
              <span className="font-mono text-xs text-neutral-500">{c.id}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
