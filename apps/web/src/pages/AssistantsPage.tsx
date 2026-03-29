import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAssistants, useCreateAssistant } from "../api/assistants";
import {
  useApiKeys,
  useCreateApiKey,
  type CreateApiKeyResponse,
} from "../api/apiKeys";
import { useModels } from "../api/models";
import { AdminCommandSelect } from "../components/admin/AdminCommandSelect";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  List,
  Loader,
  Page,
  SectionHeader,
  cn,
} from "../components/ui";
import type { Assistant } from "../api/types";

// ─── Widget install modal ─────────────────────────────────────────────────────

function buildEmbedCode(apiKey: string, assistantId: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://site-al.ru";
  return `<script src="${origin}/widget.js"><\/script>\n<script>\nwindow.AI_WIDGET_CONFIG = {\n  apiKey: "${apiKey}",\n  assistantId: "${assistantId}"\n};\n<\/script>`;
}

type ModalState =
  | { phase: "loading" }
  | { phase: "ready"; apiKey: string; keyId: string }
  | { phase: "error"; message: string };

function WidgetInstallModal({
  assistant,
  onClose,
}: {
  assistant: Assistant;
  onClose: () => void;
}) {
  const { data: allKeys, isLoading: keysLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const [modalState, setModalState] = useState<ModalState>({ phase: "loading" });
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const didCreate = useRef(false);

  useEffect(() => {
    if (keysLoading || didCreate.current) return;

    // Find existing key bound to this assistant
    const existing = allKeys?.find((k) => k.assistantId === assistant.id);
    if (existing) {
      // Key exists but we don't have the plaintext — show partial info + regen notice
      setModalState({
        phase: "error",
        message:
          "Ключ уже создан. Его значение можно увидеть только при создании. " +
          'Нажмите "Создать новый ключ", чтобы сгенерировать замену.',
      });
      return;
    }

    // Auto-create a new key for this assistant
    didCreate.current = true;
    createKey
      .mutateAsync({ assistantId: assistant.id, name: `widget:${assistant.name}` })
      .then((res: CreateApiKeyResponse) => {
        setModalState({ phase: "ready", apiKey: res.key, keyId: res.id });
      })
      .catch((e: unknown) => {
        setModalState({
          phase: "error",
          message: e instanceof Error ? e.message : "Ошибка создания ключа",
        });
      });
  }, [keysLoading, allKeys, assistant, createKey]);

  function handleCreateNew() {
    didCreate.current = true;
    setModalState({ phase: "loading" });
    createKey
      .mutateAsync({ assistantId: assistant.id, name: `widget:${assistant.name}` })
      .then((res: CreateApiKeyResponse) => {
        setModalState({ phase: "ready", apiKey: res.key, keyId: res.id });
      })
      .catch((e: unknown) => {
        setModalState({
          phase: "error",
          message: e instanceof Error ? e.message : "Ошибка создания ключа",
        });
      });
  }

  async function handleCopy() {
    if (modalState.phase !== "ready") return;
    const code = buildEmbedCode(modalState.apiKey, assistant.id);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select textarea
      codeRef.current?.select();
    }
  }

  const embedCode =
    modalState.phase === "ready"
      ? buildEmbedCode(modalState.apiKey, assistant.id)
      : "";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              Подключить на сайт
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">{assistant.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Закрыть"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {modalState.phase === "loading" && (
            <div className="flex items-center gap-3 text-sm text-neutral-500">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              Подготовка API ключа…
            </div>
          )}

          {modalState.phase === "error" && (
            <div className="space-y-3">
              <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {modalState.message}
              </p>
                <Button onClick={handleCreateNew} loading={createKey.isPending}>
                  Создать новый ключ
                </Button>
            </div>
          )}

          {modalState.phase === "ready" && (
            <>
              <div>
                <p className="mb-2 text-sm text-neutral-600">
                  Скопируйте код и вставьте перед{" "}
                  <code className="rounded bg-neutral-100 px-1 text-xs">&lt;/body&gt;</code>{" "}
                  на вашем сайте:
                </p>
                <textarea
                  ref={codeRef}
                  readOnly
                  value={embedCode}
                  rows={7}
                  className={cn(
                    "w-full resize-none rounded-md border border-neutral-200 bg-neutral-50",
                    "px-3 py-2 font-mono text-xs text-neutral-800",
                    "focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                  )}
                  onClick={() => codeRef.current?.select()}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={() => void handleCopy()}>
                  {copied ? "✓ Скопировано!" : "Скопировать"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleCreateNew}
                  loading={createKey.isPending}
                >
                  Новый ключ
                </Button>
              </div>

              <p className="text-xs text-neutral-400">
                Ключ{" "}
                <code className="rounded bg-neutral-100 px-1">{modalState.apiKey.slice(0, 12)}…</code>{" "}
                показывается только сейчас. Сохраните его.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AssistantsPage() {
  const { data, isLoading, isError, error, refetch } = useAssistants();
  const createMutation = useCreateAssistant();
  const {
    data: modelCatalog,
    isLoading: modelsLoading,
    isError: modelsCatalogError,
  } = useModels();

  const modelOptions = useMemo(
    () => (modelCatalog ?? []).map((m) => ({ value: m, label: m })),
    [modelCatalog]
  );

  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant."
  );

  const [connectAssistant, setConnectAssistant] = useState<Assistant | null>(null);

  useEffect(() => {
    const list = modelCatalog;
    if (!list?.length) return;
    if (model === "" || !list.includes(model)) {
      setModel(list[0]);
    }
  }, [modelCatalog, model]);

  const message =
    error instanceof Error ? error.message : "Ошибка загрузки";

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    const m = model.trim();
    const s = systemPrompt.trim();
    if (!n || !m || !s) return;
    await createMutation.mutateAsync({
      name: n,
      model: m,
      systemPrompt: s,
    });
    setName("");
  }

  return (
    <Page
      title="Ассистенты"
      description="Создание, модель и системный промпт. Список ниже."
    >
      <Card className="mb-6">
        <CardContent className="pt-5">
          <SectionHeader title="Новый ассистент" className="mb-4" />
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="asst-name"
                label="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Support"
                required
                autoComplete="off"
              />
              <div>
                <AdminCommandSelect
                  id="asst-model"
                  label="Модель"
                  options={modelOptions}
                  value={model}
                  onChange={setModel}
                  placeholder="Выберите модель"
                  searchPlaceholder="Поиск модели…"
                  disabled={modelsLoading || modelOptions.length === 0}
                />
                {modelsCatalogError ? (
                  <p className="mt-1 text-xs text-amber-800">
                    Не удалось загрузить список моделей. Обновите страницу.
                  </p>
                ) : null}
              </div>
            </div>
            <div>
              <label
                htmlFor="asst-prompt"
                className="block text-xs font-medium text-neutral-600"
              >
                Системный промпт
              </label>
              <textarea
                id="asst-prompt"
                className={cn(
                  "mt-1 min-h-[120px] w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400",
                  "focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                )}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                required
                placeholder="Инструкции для модели…"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                loading={createMutation.isPending}
                disabled={createMutation.isPending}
              >
                Создать
              </Button>
              {createMutation.isError && createMutation.error instanceof Error ? (
                <span className="text-sm text-red-700">
                  {createMutation.error.message}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {isLoading ? <Loader /> : null}

      {isError ? (
        <ErrorState message={message} onRetry={() => void refetch()} />
      ) : null}

      {!isLoading && !isError && data?.length === 0 ? (
        <EmptyState title="Ассистентов пока нет" />
      ) : null}

      {!isLoading && !isError && data && data.length > 0 ? (
        <>
          <SectionHeader title="Список ассистентов" />
          <List
            className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            items={data}
            getKey={(a) => a.id}
            renderItem={(a) => (
              <Card className="h-full hover:border-neutral-300">
                <CardContent className="flex h-full flex-col">
                  <h3 className="font-semibold text-neutral-900">{a.name}</h3>
                  <p className="mt-1 font-mono text-xs text-neutral-500">
                    {a.model}
                  </p>
                  <p className="mt-3 line-clamp-3 flex-1 text-sm text-neutral-600">
                    {a.systemPrompt}
                  </p>
                  <div className="mt-4">
                    <button
                      onClick={() => setConnectAssistant(a)}
                      className={cn(
                        "inline-flex w-full items-center justify-center gap-1.5 rounded-md",
                        "border border-neutral-200 bg-neutral-50 px-3 py-1.5",
                        "text-xs font-medium text-neutral-700",
                        "hover:border-neutral-300 hover:bg-white transition-colors"
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M1 6h10M6 1v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      Подключить на сайт
                    </button>
                  </div>
                </CardContent>
              </Card>
            )}
          />
        </>
      ) : null}

      {connectAssistant ? (
        <WidgetInstallModal
          assistant={connectAssistant}
          onClose={() => setConnectAssistant(null)}
        />
      ) : null}
    </Page>
  );
}
