import { type FormEvent, useState } from "react";
import { useApiKeys, useCreateApiKey } from "../api/apiKeys";
import { ApiError } from "../lib/apiClient";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApiKeysPage() {
  const { data: keys, isLoading, error } = useApiKeys();
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [revealedOnce, setRevealedOnce] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const res = await createKey.mutateAsync({
        name: name.trim() || undefined,
      });
      setRevealedOnce(res.key);
      setName("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Не удалось создать ключ");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">API ключи</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Панель использует JWT (<code className="font-mono text-xs">Authorization: Bearer &lt;JWT&gt;</code>).
          Ключ <code className="font-mono text-xs">sk-…</code> для интеграций передавайте в заголовке{" "}
          <code className="rounded bg-neutral-100 px-1 font-mono text-xs">X-Api-Key</code> (например для{" "}
          <code className="font-mono text-xs">POST /chat</code>), не в Authorization. Ключ показывается один раз
          при создании.
        </p>
      </div>

      {revealedOnce ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">Сохраните ключ сейчас — позже он не отображается.</p>
          <p className="mt-2 break-all font-mono text-xs">{revealedOnce}</p>
          <button
            type="button"
            className="mt-3 text-sm font-medium underline"
            onClick={() => setRevealedOnce(null)}
          >
            Скрыть
          </button>
        </div>
      ) : null}

      <form onSubmit={handleCreate} className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-medium text-neutral-800">Новый ключ</h2>
        {formError ? (
          <p className="text-sm text-red-700">{formError}</p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="key-name" className="block text-xs font-medium text-neutral-600">
              Название (необязательно)
            </label>
            <input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production, staging…"
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={createKey.isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {createKey.isPending ? "Создание…" : "Создать ключ"}
          </button>
        </div>
      </form>

      <div>
        <h2 className="text-sm font-medium text-neutral-800">Ваши ключи</h2>
        {isLoading ? (
          <p className="mt-2 text-sm text-neutral-500">Загрузка…</p>
        ) : error ? (
          <p className="mt-2 text-sm text-red-700">Не удалось загрузить список</p>
        ) : !keys?.length ? (
          <p className="mt-2 text-sm text-neutral-500">Пока нет ключей</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-neutral-900">{k.name ?? "Без названия"}</p>
                  <p className="font-mono text-xs text-neutral-500">id: {k.id}</p>
                </div>
                <p className="text-xs text-neutral-500">{formatDate(k.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
