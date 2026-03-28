import { useAssistants } from "../api/assistants";

export function AssistantsPage() {
  const { data, isLoading, isError, error } = useAssistants();

  return (
    <div className="space-y-6 transition-all duration-200 ease-out">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          Ассистенты
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Модели и системные промпты вашего аккаунта.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-neutral-500">Загрузка…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error instanceof Error ? error.message : "Ошибка загрузки"}
        </div>
      )}

      {data && data.length === 0 && (
        <p className="text-sm text-neutral-500">Ассистентов пока нет.</p>
      )}

      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((a) => (
            <li
              key={a.id}
              className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition-all duration-200 ease-out hover:border-neutral-300"
            >
              <h3 className="font-semibold text-neutral-900">{a.name}</h3>
              <p className="mt-1 font-mono text-xs text-neutral-500">{a.model}</p>
              <p className="mt-3 line-clamp-3 text-sm text-neutral-600">
                {a.systemPrompt}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
