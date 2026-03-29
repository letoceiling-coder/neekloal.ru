import { type FormEvent, useMemo, useState } from "react";
import {
  type ApiKeyRow,
  useApiKeys,
  useCreateApiKey,
} from "../api/apiKeys";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  DataTable,
  type DataTableColumn,
  ErrorState,
  Input,
  Page,
  SectionHeader,
} from "../components/ui";
import { ApiError } from "../lib/apiClient";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApiKeysPage() {
  const { data: keys, isLoading, error, refetch } = useApiKeys();
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [revealedOnce, setRevealedOnce] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const columns = useMemo<DataTableColumn<ApiKeyRow>[]>(
    () => [
      {
        id: "name",
        header: "Название",
        cell: (k) => k.name ?? "Без названия",
      },
      {
        id: "id",
        header: "ID",
        cell: (k) => (
          <span className="font-mono text-xs text-neutral-500">{k.id}</span>
        ),
      },
      {
        id: "created",
        header: "Создан",
        cell: (k) => (
          <span className="text-xs text-neutral-500">
            {formatDate(k.createdAt)}
          </span>
        ),
      },
    ],
    []
  );

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
      setFormError(
        err instanceof ApiError ? err.message : "Не удалось создать ключ"
      );
    }
  }

  const listErrorMessage =
    error instanceof Error
      ? error.message
      : "Не удалось загрузить список ключей.";

  return (
    <Page
      className="mx-auto max-w-3xl"
      title="API ключи"
      description={
        <>
          Панель использует JWT (
          <code className="font-mono text-xs">
            Authorization: Bearer &lt;JWT&gt;
          </code>
          ). Ключ <code className="font-mono text-xs">sk-…</code> для
          интеграций передавайте в заголовке{" "}
          <code className="rounded bg-neutral-100 px-1 font-mono text-xs">
            X-Api-Key
          </code>{" "}
          (например для <code className="font-mono text-xs">POST /chat</code>),
          не в Authorization. Ключ показывается один раз при создании.
        </>
      }
    >
      {revealedOnce ? (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="text-sm text-amber-950">
            <p className="font-medium">
              Сохраните ключ сейчас — позже он не отображается.
            </p>
            <p className="mt-2 break-all font-mono text-xs">{revealedOnce}</p>
            <Button
              type="button"
              variant="ghost"
              className="mt-3 underline"
              onClick={() => setRevealedOnce(null)}
            >
              Скрыть
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-neutral-800">Новый ключ</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Input
                id="key-name"
                label="Название (необязательно)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production, staging…"
                error={formError ?? undefined}
              />
              <Button type="submit" loading={createKey.isPending}>
                {createKey.isPending ? "Создание…" : "Создать ключ"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <SectionHeader title="Ваши ключи" className="mt-2" />
        {error ? (
          <ErrorState
            className="mt-3"
            message={listErrorMessage}
            onRetry={() => void refetch()}
          />
        ) : (
          <DataTable
            className="mt-3"
            columns={columns}
            rows={keys ?? []}
            getRowId={(k) => k.id}
            isLoading={isLoading}
            emptyTitle="Пока нет ключей"
          />
        )}
      </div>
    </Page>
  );
}
