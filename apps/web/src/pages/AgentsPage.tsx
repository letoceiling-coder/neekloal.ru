import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAgents, useCreateAgent, useModels } from "../api/agents";
import type { Agent } from "../api/types";
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

const FALLBACK_MODELS = ["llama3:8b", "qwen2.5:7b"];

export function AgentsPage() {
  const { data: agents, isLoading, error, refetch } = useAgents();
  const { data: assistants } = useAssistants();
  const { data: modelsData }  = useModels();
  const createAgent = useCreateAgent();

  const availableModels = modelsData?.models?.map((m) => m.name) ?? FALLBACK_MODELS;

  const [name,        setName]        = useState("");
  const [type,        setType]        = useState("default");
  const [mode,        setMode]        = useState<"v1" | "v2">("v1");
  const [model,       setModel]       = useState(FALLBACK_MODELS[0]);
  const [assistantId, setAssistantId] = useState("");
  const [formError,   setFormError]   = useState<string | null>(null);

  const columns = useMemo<DataTableColumn<Agent>[]>(
    () => [
      {
        id: "name",
        header: "Название",
        cell: (a) => (
          <Link
            to={`/agents/${a.id}`}
            className="font-medium text-neutral-900 underline-offset-2 hover:underline"
          >
            {a.name}
          </Link>
        ),
      },
      {
        id: "type",
        header: "Тип",
        cell: (a) => (
          <span className="font-mono text-xs text-neutral-600">{a.type}</span>
        ),
      },
      {
        id: "mode",
        header: "Режим",
        cell: (a) => (
          <span className="font-mono text-xs text-neutral-600">{a.mode}</span>
        ),
      },
      {
        id: "model",
        header: "Модель",
        cell: (a) => (
          <span className="font-mono text-xs text-violet-600">{a.model ?? "—"}</span>
        ),
      },
      {
        id: "tools",
        header: "Инструменты",
        cell: (a) => (a.tools?.length ?? 0),
      },
    ],
    []
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const n = name.trim();
    if (!n) {
      setFormError("Укажите название");
      return;
    }
    const t = type.trim();
    if (!t) {
      setFormError("Укажите тип");
      return;
    }
    try {
      await createAgent.mutateAsync({
        name: n,
        type: t,
        mode,
        model: model || null,
        assistantId: assistantId.trim() || null,
      });
      setName("");
      setType("default");
      setMode("v1");
      setModel(FALLBACK_MODELS[0]);
      setAssistantId("");
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Не удалось создать агента"
      );
    }
  }

  return (
    <Page
      className="mx-auto max-w-3xl"
      title="Агенты"
      description="Список, создание и запуск через привязанного ассистента (POST /chat)."
    >
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-neutral-800">Создать</h3>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Input
                id="agent-name"
                label="Название"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Мой агент"
                error={undefined}
              />
              <Input
                id="agent-type"
                label="Тип"
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="default"
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="agent-mode"
                  className="block text-xs font-medium text-neutral-600"
                >
                  Режим
                </label>
                <select
                  id="agent-mode"
                  className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "v1" | "v2")}
                >
                  <option value="v1">v1</option>
                  <option value="v2">v2</option>
                </select>
              </div>
            </div>
            <div>
              <label
                htmlFor="agent-model"
                className="block text-xs font-medium text-neutral-600"
              >
                Модель LLM
              </label>
              <select
                id="agent-model"
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                Независимо от ассистента — используется в Playground
              </p>
            </div>
            <div>
              <label
                htmlFor="agent-assistant"
                className="block text-xs font-medium text-neutral-600"
              >
                Ассистент (необязательно)
              </label>
              <select
                id="agent-assistant"
                className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                value={assistantId}
                onChange={(e) => setAssistantId(e.target.value)}
              >
                <option value="">—</option>
                {(assistants ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            {formError ? (
              <p className="text-sm text-red-700" role="alert">
                {formError}
              </p>
            ) : null}
            <Button type="submit" loading={createAgent.isPending}>
              Создать
            </Button>
          </form>
        </CardContent>
      </Card>

      <SectionHeader title="Список" className="mt-8" />
      {error ? (
        <ErrorState
          className="mt-3"
          message={
            error instanceof Error ? error.message : "Не удалось загрузить"
          }
          onRetry={() => void refetch()}
        />
      ) : (
        <DataTable
          className="mt-3"
          columns={columns}
          rows={agents ?? []}
          getRowId={(a) => a.id}
          isLoading={isLoading}
          emptyTitle="Нет агентов"
        />
      )}
    </Page>
  );
}
