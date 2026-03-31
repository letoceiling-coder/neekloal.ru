import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { mapChatToSteps } from "../api/mapChatToSteps";
import { useAgents, useRunAgentChat, usePatchAgent } from "../api/agents";
import type { AgentExecutionStep } from "../api/types";
import { useAssistants } from "../api/assistants";
import { AgentExecutionView } from "../components/agents/AgentExecutionView";
import { AgentRunInput } from "../components/agents/AgentRunInput";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ErrorState,
  Page,
  SectionHeader,
} from "../components/ui";
import { ApiError } from "../lib/apiClient";

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { data: agents, isLoading, error, refetch } = useAgents();
  const { data: assistants } = useAssistants();
  const runChat = useRunAgentChat();

  const agent = useMemo(
    () => agents?.find((a) => a.id === agentId) ?? null,
    [agents, agentId]
  );

  const assistantModel = useMemo(() => {
    if (!agent?.assistantId || !assistants) return null;
    return assistants.find((x) => x.id === agent.assistantId)?.model ?? null;
  }, [agent, assistants]);

  const patchAgent = usePatchAgent();
  const [input,    setInput]    = useState("");
  const [steps,    setSteps]    = useState<AgentExecutionStep[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  async function toggleAutoReply() {
    if (!agent) return;
    await patchAgent.mutateAsync({ id: agent.id, autoReply: !(agent.autoReply ?? true) });
  }

  const agentHasTools = Boolean(agent?.tools && agent.tools.length > 0);

  async function handleRun() {
    if (!agent?.assistantId || !input.trim()) return;
    setRunError(null);
    setSteps([]);
    const msg = input.trim();
    const runId = `run-${Date.now()}`;
    try {
      const res = await runChat.mutateAsync({
        assistantId: agent.assistantId,
        message: msg,
      });
      setSteps(
        mapChatToSteps(runId, msg, res, { agentHasTools })
      );
    } catch (e) {
      const text =
        e instanceof ApiError ? e.message : "Не удалось выполнить запрос";
      setRunError(text);
    }
  }

  if (isLoading) {
    return (
      <Page title="Агент" className="mx-auto max-w-3xl">
        <p className="text-sm text-neutral-500">Загрузка…</p>
      </Page>
    );
  }

  if (error) {
    return (
      <Page title="Агент" className="mx-auto max-w-3xl">
        <ErrorState
          message={error instanceof Error ? error.message : "Ошибка"}
          onRetry={() => void refetch()}
        />
        <Button
          variant="ghost"
          className="mt-4"
          type="button"
          onClick={() => navigate("/agents")}
        >
          К списку
        </Button>
      </Page>
    );
  }

  if (!agent) {
    return (
      <Page title="Агент не найден" className="mx-auto max-w-3xl">
        <p className="text-sm text-neutral-600">Нет агента с таким id.</p>
        <Link to="/agents" className="mt-4 inline-block text-sm text-neutral-900 underline">
          К списку агентов
        </Link>
      </Page>
    );
  }

  const canRun = Boolean(agent.assistantId);

  return (
    <Page
      className="mx-auto max-w-3xl"
      title={agent.name}
      description={
        <>
          Тип: <code className="font-mono text-xs">{agent.type}</code>, режим{" "}
          <code className="font-mono text-xs">{agent.mode}</code>
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          className="min-h-0 px-0 text-sm underline"
          onClick={() => navigate("/agents")}
        >
          ← Все агенты
        </Button>
        <Link
          to={`/agents/${agentId}/chat`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition"
        >
          🧪 Playground
        </Link>
      </div>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-neutral-800">Параметры</h3>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-neutral-700">
          <p>
            <span className="text-neutral-500">Модель:</span>{" "}
            <code className="font-mono text-xs">{agent.model ?? assistantModel ?? "—"}</code>
          </p>
          <p>
            <span className="text-neutral-500">Assistant ID:</span>{" "}
            {agent.assistantId ? (
              <code className="font-mono text-xs">{agent.assistantId}</code>
            ) : (
              "не привязан"
            )}
          </p>

          {/* Avito autoReply toggle */}
          <div className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5">
            <div>
              <p className="text-xs font-medium text-neutral-700">
                🤖 Avito AutoReply
              </p>
              <p className="text-[11px] text-neutral-400">
                Отправлять ответ ИИ обратно в Avito Messenger
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleAutoReply()}
              disabled={patchAgent.isPending}
              className={[
                "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50",
                (agent.autoReply ?? true)
                  ? "bg-violet-600"
                  : "bg-neutral-200",
              ].join(" ")}
              aria-checked={agent.autoReply ?? true}
              role="switch"
            >
              <span
                className={[
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200",
                  (agent.autoReply ?? true) ? "translate-x-4" : "translate-x-0",
                ].join(" ")}
              />
            </button>
          </div>

          {/* Webhook URL hint */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-blue-700 mb-0.5">🔗 Avito Webhook URL</p>
            <code className="block break-all text-[10px] text-blue-600">
              https://site-al.ru/api/avito/webhook/{agent.id}
            </code>
            <p className="mt-1 text-[10px] text-blue-400">
              Укажите этот URL в кабинете разработчика Avito
            </p>
          </div>
        </CardContent>
      </Card>

      <SectionHeader title="Инструменты" className="mt-6" />
      {agent.tools && agent.tools.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-sm text-neutral-700">
          {agent.tools.map((t) => (
            <li key={t.id}>
              <span className="font-medium">{t.name}</span>{" "}
              <span className="text-neutral-500">({t.type})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">Нет инструментов</p>
      )}

      <SectionHeader title="Запуск" className="mt-6" />
      {!canRun ? (
        <p className="mt-2 text-sm text-amber-800">
          Привяжите ассистента к агенту (assistantId), чтобы запускать через POST /chat.
        </p>
      ) : null}
      <div className="mt-3">
        <AgentRunInput
          value={input}
          onChange={setInput}
          onRun={() => void handleRun()}
          disabled={!canRun}
          loading={runChat.isPending}
        />
      </div>
      {runError ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {runError}
        </p>
      ) : null}

      <div className="mt-8">
        <AgentExecutionView steps={steps} isRunning={runChat.isPending} />
      </div>
    </Page>
  );
}
