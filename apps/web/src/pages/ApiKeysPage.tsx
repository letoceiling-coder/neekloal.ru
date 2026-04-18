import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type ApiKeyRow,
  useApiKeys,
  useCreateApiKey,
} from "../api/apiKeys";
import { useAssistants } from "../api/assistants";
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

/** Полный URL POST /chat для документации на странице (совпадает с VITE_API_URL + /v1/chat). */
function resolvePublicV1ChatUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return `${String(fromEnv).replace(/\/$/, "")}/v1/chat`;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/api/v1/chat`;
  }
  return "https://site-al.ru/api/v1/chat";
}

function parseDomainsInput(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function ApiKeysPage() {
  const { data: keys, isLoading, error, refetch } = useApiKeys();
  const { data: assistants } = useAssistants();
  const createKey = useCreateApiKey();
  const [name, setName] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [allowedDomainsRaw, setAllowedDomainsRaw] = useState("");
  const [revealedOnce, setRevealedOnce] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const exampleChatUrl = useMemo(() => resolvePublicV1ChatUrl(), []);
  const exampleStreamUrl = useMemo(
    () => `${exampleChatUrl}/stream`,
    [exampleChatUrl]
  );

  const assistantById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of assistants ?? []) m.set(a.id, a.name);
    return m;
  }, [assistants]);

  const columns = useMemo<DataTableColumn<ApiKeyRow>[]>(
    () => [
      {
        id: "name",
        header: "Название",
        cell: (k) => k.name ?? "Без названия",
      },
      {
        id: "assistant",
        header: "Ассистент (метка)",
        cell: (k) =>
          k.assistantId ? (
            <span className="text-xs text-neutral-700" title={k.assistantId}>
              {assistantById.get(k.assistantId) ?? `${k.assistantId.slice(0, 8)}…`}
            </span>
          ) : (
            <span className="text-xs text-neutral-400">—</span>
          ),
      },
      {
        id: "domains",
        header: "Домены сайта",
        cell: (k) =>
          k.allowedDomains?.length ? (
            <span className="max-w-[200px] text-xs break-all text-neutral-600">
              {k.allowedDomains.join(", ")}
            </span>
          ) : (
            <span className="text-xs text-emerald-800">без ограничений</span>
          ),
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
    [assistantById]
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const domains = parseDomainsInput(allowedDomainsRaw);
    try {
      const res = await createKey.mutateAsync({
        name: name.trim() || undefined,
        assistantId: assistantId.trim() || undefined,
        allowedDomains: domains.length > 0 ? domains : undefined,
      });
      setRevealedOnce(res.key);
      setName("");
      setAssistantId("");
      setAllowedDomainsRaw("");
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
          В панели вход по JWT; для своего сайта или сервера используйте ключ{" "}
          <code className="font-mono text-xs">sk-…</code> в заголовке{" "}
          <code className="rounded bg-neutral-100 px-1 font-mono text-xs">
            X-Api-Key
          </code>
          . Ключ виден один раз при создании. Ниже — как выбрать агента и
          модель в запросе.
        </>
      }
    >
      <Card className="mb-4 border-violet-100 bg-violet-50/60">
        <CardHeader>
          <h3 className="text-sm font-medium text-neutral-900">
            Как сайт обращается к нужному агенту
          </h3>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-neutral-800">
          <p className="leading-relaxed">
            Ключ привязан к <strong>организации</strong>, а не к одному агенту.
            Какому агенту идёт запрос, вы задаёте <strong>в теле каждого</strong>{" "}
            HTTP-запроса полем <code className="font-mono text-xs">agentId</code>{" "}
            (UUID агента со{" "}
            <Link to="/agents" className="text-violet-800 underline underline-offset-2">
              страницы «Агенты»
            </Link>
            , откройте агента — id в адресе{" "}
            <code className="font-mono text-xs">/agents/&lt;id&gt;</code>).
          </p>
          <p className="leading-relaxed">
            <strong>Модель:</strong> необязательно передайте{" "}
            <code className="font-mono text-xs">model</code> в JSON. Иначе
            используется модель, указанная у агента в панели, затем серверный
            выбор по умолчанию.
          </p>
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <p className="mb-2 text-xs font-medium text-neutral-600">
              Пример: один запрос к агенту
            </p>
            <pre className="overflow-x-auto text-[11px] leading-snug text-neutral-800">
{`POST ${exampleChatUrl}
Content-Type: application/json
X-Api-Key: sk-…

{
  "agentId": "<uuid-агента-со-страницы-Агенты>",
  "message": "Здравствуйте"
}`}
            </pre>
            <p className="mt-2 text-xs text-neutral-600">
              Ответ содержит <code className="font-mono text-[10px]">reply</code> и{" "}
              <code className="font-mono text-[10px]">conversationId</code> —
              передавайте его в следующих сообщениях для той же ветки диалога.
              Потоковый вариант:{" "}
              <code className="font-mono text-[10px] break-all">
                POST {exampleStreamUrl}
              </code>{" "}
              (SSE).
            </p>
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed">
            Если при создании ключа указаны <strong>домены сайта</strong>, с
            браузера запрос должен уходить со страницы этого хоста (заголовок
            Origin), иначе будет 403. Пустой список доменов — без ограничения
            (удобно для сервер-сервер). Опциональный ассистент при создании
            ключа — для учёта и сценариев виджета; для{" "}
            <code className="font-mono text-[10px]">/api/v1/chat</code> роль
            агента по-прежнему задаётся полем <code className="font-mono text-[10px]">agentId</code>.
          </p>
        </CardContent>
      </Card>

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
                placeholder="chepy, production…"
              />
              <Button type="submit" loading={createKey.isPending}>
                {createKey.isPending ? "Создание…" : "Создать ключ"}
              </Button>
            </div>
            <div>
              <label
                htmlFor="key-assistant"
                className="block text-xs font-medium text-neutral-600"
              >
                Ассистент (необязательно)
              </label>
              <select
                id="key-assistant"
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                value={assistantId}
                onChange={(e) => setAssistantId(e.target.value)}
              >
                <option value="">— не привязывать</option>
                {(assistants ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Для виджета/учёта. Какой агент отвечает в API — всегда через{" "}
                <code className="font-mono text-[10px]">agentId</code> в теле{" "}
                <code className="font-mono text-[10px]">POST /api/v1/chat</code>.
              </p>
            </div>
            <div>
              <label
                htmlFor="key-domains"
                className="block text-xs font-medium text-neutral-600"
              >
                Разрешённые домены для браузера (необязательно)
              </label>
              <textarea
                id="key-domains"
                rows={2}
                value={allowedDomainsRaw}
                onChange={(e) => setAllowedDomainsRaw(e.target.value)}
                placeholder="example.com, www.example.com, *.app.example.com"
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-violet-400 focus:outline-none"
              />
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Через запятую или с новой строки. Пусто — запросы с любого Origin
                (для вызова только с вашего бэкенда оставьте пустым).
              </p>
            </div>
            {formError ? (
              <p className="text-sm text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
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
