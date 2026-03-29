import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAssistants, useCreateAssistant } from "../api/assistants";
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
                <CardContent>
                  <h3 className="font-semibold text-neutral-900">{a.name}</h3>
                  <p className="mt-1 font-mono text-xs text-neutral-500">
                    {a.model}
                  </p>
                  <p className="mt-3 line-clamp-3 text-sm text-neutral-600">
                    {a.systemPrompt}
                  </p>
                </CardContent>
              </Card>
            )}
          />
        </>
      ) : null}
    </Page>
  );
}
