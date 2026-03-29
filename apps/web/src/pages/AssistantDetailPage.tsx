import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAssistants, usePatchAssistant } from "../api/assistants";
import { useAgents, useCreateAgent, usePatchAgent } from "../api/agents";
import { useApiKeys, useCreateApiKey, type CreateApiKeyResponse } from "../api/apiKeys";
import { useAddKnowledge } from "../api/knowledge";
import { useModels } from "../api/models";
import { useUsage } from "../api/usage";
import { useAuthStore } from "../stores/authStore";
import { AdminCommandSelect } from "../components/admin/AdminCommandSelect";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Loader,
  Page,
  cn,
} from "../components/ui";
import type { Assistant, Agent } from "../api/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function getApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv != null && String(fromEnv).trim() !== "") {
    return String(fromEnv).replace(/\/$/, "");
  }
  return `${window.location.origin}/api`;
}

function buildEmbedCode(apiKey: string, assistantId: string): string {
  return `<script src="${window.location.origin}/widget.js"><\/script>\n<script>\nwindow.AI_WIDGET_CONFIG = {\n  apiKey: "${apiKey}",\n  assistantId: "${assistantId}"\n};\n<\/script>`;
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

type TabId = "basic" | "agent" | "knowledge" | "widget" | "chat" | "usage";

const TABS: { id: TabId; label: string }[] = [
  { id: "basic", label: "Настройки" },
  { id: "agent", label: "Агент" },
  { id: "knowledge", label: "База знаний" },
  { id: "widget", label: "Виджет" },
  { id: "chat", label: "Живой чат" },
  { id: "usage", label: "Статистика" },
];

function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-neutral-100 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
            active === t.id
              ? "bg-white text-neutral-900 shadow-sm"
              : "text-neutral-500 hover:text-neutral-700"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Section: Basic ───────────────────────────────────────────────────────────

function BasicSection({ assistant }: { assistant: Assistant }) {
  const patchAssistant = usePatchAssistant();
  const { data: modelCatalog, isLoading: modelsLoading } = useModels();
  const modelOptions = useMemo(
    () => (modelCatalog ?? []).map((m) => ({ value: m, label: m })),
    [modelCatalog]
  );

  const [name, setName] = useState(assistant.name);
  const [model, setModel] = useState(assistant.model);
  const [systemPrompt, setSystemPrompt] = useState(assistant.systemPrompt);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    await patchAssistant.mutateAsync({
      id: assistant.id,
      name: name.trim() || undefined,
      model: model || undefined,
      systemPrompt: systemPrompt || undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">Основные настройки</h3>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <Input
            id="basic-name"
            label="Имя ассистента"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <div>
            <AdminCommandSelect
              id="basic-model"
              label="Модель"
              options={modelOptions}
              value={model}
              onChange={setModel}
              placeholder="Выберите модель"
              searchPlaceholder="Поиск…"
              disabled={modelsLoading || modelOptions.length === 0}
            />
          </div>
          <div>
            <label htmlFor="basic-prompt" className="block text-xs font-medium text-neutral-600">
              Системный промпт
            </label>
            <textarea
              id="basic-prompt"
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={patchAssistant.isPending}>
              Сохранить
            </Button>
            {saved && <span className="text-sm text-green-600">✓ Сохранено</span>}
            {patchAssistant.isError && (
              <span className="text-sm text-red-600">
                {patchAssistant.error instanceof Error
                  ? patchAssistant.error.message
                  : "Ошибка"}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Section: Agent ───────────────────────────────────────────────────────────

function AgentSection({
  assistant,
  agents,
}: {
  assistant: Assistant;
  agents: Agent[];
}) {
  const linkedAgent = agents.find((a) => a.assistantId === assistant.id) ?? null;
  const patchAgent = usePatchAgent();
  const createAgent = useCreateAgent();

  const [rules, setRules] = useState(linkedAgent?.rules ?? "");
  const [agentName, setAgentName] = useState("");
  const [agentRules, setAgentRules] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (linkedAgent) setRules(linkedAgent.rules ?? "");
  }, [linkedAgent?.id]);

  async function handleSaveRules(e: FormEvent) {
    e.preventDefault();
    if (!linkedAgent) return;
    await patchAgent.mutateAsync({ id: linkedAgent.id, rules });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const n = agentName.trim();
    if (!n) return;
    await createAgent.mutateAsync({
      name: n,
      type: "planner",
      mode: "v1",
      assistantId: assistant.id,
      rules: agentRules || null,
    });
    setAgentName("");
    setAgentRules("");
  }

  if (linkedAgent) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-neutral-800">
              Агент: {linkedAgent.name}
            </h3>
            <p className="mt-0.5 text-xs text-neutral-400">
              Тип: {linkedAgent.type} · Режим: {linkedAgent.mode}
            </p>
          </div>
          <Link
            to={`/agents/${linkedAgent.id}`}
            className="text-xs text-neutral-500 underline hover:text-neutral-700"
          >
            Полный редактор →
          </Link>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSaveRules(e)} className="space-y-3">
            <div>
              <label htmlFor="agent-rules" className="block text-xs font-medium text-neutral-600">
                Правила агента (rules)
              </label>
              <textarea
                id="agent-rules"
                rows={8}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder="Опишите инструкции для агента…"
                className="mt-1 w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={patchAgent.isPending}>
                Сохранить правила
              </Button>
              {saved && <span className="text-sm text-green-600">✓ Сохранено</span>}
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">Агент не подключён</h3>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-neutral-500">
          Агент добавляет к ассистенту расширенную логику — правила поведения,
          сценарии и инструменты.
        </p>
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3">
          <Input
            id="new-agent-name"
            label="Имя агента"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Например, Support Agent"
            required
          />
          <div>
            <label htmlFor="new-agent-rules" className="block text-xs font-medium text-neutral-600">
              Правила (необязательно)
            </label>
            <textarea
              id="new-agent-rules"
              rows={5}
              value={agentRules}
              onChange={(e) => setAgentRules(e.target.value)}
              placeholder="Отвечай только на русском. Если не знаешь — скажи об этом."
              className="mt-1 w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={createAgent.isPending}>
              Создать агент
            </Button>
            {createAgent.isError && (
              <span className="text-sm text-red-600">
                {createAgent.error instanceof Error ? createAgent.error.message : "Ошибка"}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Section: Knowledge ───────────────────────────────────────────────────────

function KnowledgeSection({ assistant }: { assistant: Assistant }) {
  const addKnowledge = useAddKnowledge();
  const [content, setContent] = useState("");
  const [added, setAdded] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const text = content.trim();
    if (!text) return;
    await addKnowledge.mutateAsync({ assistantId: assistant.id, content: text });
    setContent("");
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">База знаний</h3>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-neutral-500">
          Добавьте текст, который ассистент будет использовать при ответах (RAG).
        </p>
        <form onSubmit={(e) => void handleAdd(e)} className="space-y-3">
          <div>
            <label htmlFor="knowledge-text" className="block text-xs font-medium text-neutral-600">
              Текст знаний
            </label>
            <textarea
              id="knowledge-text"
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Вставьте статью, инструкцию, FAQ или другой текст…"
              className="mt-1 w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" loading={addKnowledge.isPending}>
              Добавить
            </Button>
            {added && (
              <span className="text-sm text-green-600">✓ Знания добавлены</span>
            )}
            {addKnowledge.isError && (
              <span className="text-sm text-red-600">
                {addKnowledge.error instanceof Error
                  ? addKnowledge.error.message
                  : "Ошибка"}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Section: Widget ──────────────────────────────────────────────────────────

type WidgetPhase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; apiKey: string }
  | { status: "error"; message: string };

function WidgetSection({ assistant }: { assistant: Assistant }) {
  const { data: allKeys, isLoading: keysLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const [phase, setPhase] = useState<WidgetPhase>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (keysLoading || phase.status !== "idle") return;

    const existing = allKeys?.find((k) => k.assistantId === assistant.id);
    if (existing) {
      setPhase({
        status: "error",
        message:
          "Ключ уже создан. Значение видно только при первом создании. " +
          'Нажмите "Новый ключ" чтобы сгенерировать замену.',
      });
      return;
    }

    setPhase({ status: "loading" });
    createKey
      .mutateAsync({ assistantId: assistant.id, name: `widget:${assistant.name}` })
      .then((res: CreateApiKeyResponse) => {
        setPhase({ status: "ready", apiKey: res.key });
      })
      .catch((e: unknown) => {
        setPhase({
          status: "error",
          message: e instanceof Error ? e.message : "Ошибка создания ключа",
        });
      });
  }, [keysLoading]);

  function handleNewKey() {
    setPhase({ status: "loading" });
    createKey
      .mutateAsync({ assistantId: assistant.id, name: `widget:${assistant.name}` })
      .then((res: CreateApiKeyResponse) => {
        setPhase({ status: "ready", apiKey: res.key });
      })
      .catch((e: unknown) => {
        setPhase({
          status: "error",
          message: e instanceof Error ? e.message : "Ошибка создания ключа",
        });
      });
  }

  async function handleCopy() {
    if (phase.status !== "ready") return;
    const code = buildEmbedCode(phase.apiKey, assistant.id);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      codeRef.current?.select();
    }
  }

  const embedCode =
    phase.status === "ready"
      ? buildEmbedCode(phase.apiKey, assistant.id)
      : "";

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">Виджет для сайта</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase.status === "loading" && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader className="h-4 w-4" />
            Подготовка ключа…
          </div>
        )}

        {phase.status === "error" && (
          <div className="space-y-3">
            <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {phase.message}
            </p>
            <Button variant="secondary" onClick={handleNewKey} loading={createKey.isPending}>
              Новый ключ
            </Button>
          </div>
        )}

        {phase.status === "ready" && (
          <>
            <p className="text-sm text-neutral-600">
              Вставьте код перед{" "}
              <code className="rounded bg-neutral-100 px-1 text-xs">&lt;/body&gt;</code>:
            </p>
            <textarea
              ref={codeRef}
              readOnly
              value={embedCode}
              rows={7}
              className="w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              onClick={() => codeRef.current?.select()}
            />
            <div className="flex items-center gap-3">
              <Button onClick={() => void handleCopy()}>
                {copied ? "✓ Скопировано!" : "Скопировать код"}
              </Button>
              <Button variant="secondary" onClick={handleNewKey} loading={createKey.isPending}>
                Новый ключ
              </Button>
            </div>
            <p className="text-xs text-neutral-400">
              Ключ{" "}
              <code className="rounded bg-neutral-100 px-1">
                {phase.apiKey.slice(0, 14)}…
              </code>{" "}
              показывается только сейчас.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Chat ────────────────────────────────────────────────────────────

type ChatMsg = { id: string; role: "user" | "ai"; text: string };

function ChatSection({ assistant }: { assistant: Assistant }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", text };
    const botId = `b-${Date.now()}`;
    const botMsg: ChatMsg = { id: botId, role: "ai", text: "" };
    setMessages((prev) => [...prev, userMsg, botMsg]);
    setStreaming(true);

    try {
      const base = getApiBase();
      const res = await fetch(`${base}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ assistantId: assistant.id, message: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim()) as {
              token?: string;
              error?: string;
            };
            if (payload.token) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId ? { ...m, text: m.text + payload.token } : m
                )
              );
            }
            if (payload.error) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId ? { ...m, text: `⚠ ${payload.error}` } : m
                )
              );
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка";
      setMessages((prev) =>
        prev.map((m) => (m.id === botId ? { ...m, text: `⚠ ${msg}` } : m))
      );
    } finally {
      setStreaming(false);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">Живой чат — тест</h3>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="text-xs text-neutral-400 hover:text-neutral-600"
          >
            Очистить
          </button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          {messages.length === 0 && (
            <p className="m-auto text-sm text-neutral-400">
              Напишите сообщение для теста ассистента
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-sm whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-800 shadow-sm ring-1 ring-neutral-200"
                )}
              >
                {m.text ||
                  (streaming && m.role === "ai" ? (
                    <span className="animate-pulse text-neutral-400">●●●</span>
                  ) : (
                    ""
                  ))}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2">
          <Input
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ваше сообщение…"
            disabled={streaming}
          />
          <Button onClick={() => void send()} loading={streaming} disabled={!input.trim()}>
            Отправить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Section: Usage ───────────────────────────────────────────────────────────

function UsageSection() {
  const { data, isLoading, isError } = useUsage();

  if (isLoading) return <Loader />;
  if (isError || !data) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-neutral-500">Не удалось загрузить статистику.</p>
        </CardContent>
      </Card>
    );
  }

  const modelEntries = Object.entries(data.byModel);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">Использование (организация)</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-neutral-50 px-4 py-3">
            <p className="text-xs text-neutral-500">Запросов</p>
            <p className="mt-0.5 text-xl font-semibold text-neutral-900">
              {data.totalRequests.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-4 py-3">
            <p className="text-xs text-neutral-500">Токенов</p>
            <p className="mt-0.5 text-xl font-semibold text-neutral-900">
              {data.totalTokens.toLocaleString()}
            </p>
          </div>
        </div>

        {modelEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-neutral-500">По моделям</p>
            <div className="space-y-1.5">
              {modelEntries.map(([model, stats]) => (
                <div
                  key={model}
                  className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2"
                >
                  <code className="text-xs text-neutral-700">{model}</code>
                  <div className="flex gap-4 text-xs text-neutral-500">
                    <span>{stats.requests} req</span>
                    <span>{stats.tokens.toLocaleString()} tok</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AssistantDetailPage() {
  const { assistantId } = useParams<{ assistantId: string }>();
  const navigate = useNavigate();
  const { data: assistants, isLoading: assistantsLoading } = useAssistants();
  const { data: agents = [] } = useAgents();
  const [activeTab, setActiveTab] = useState<TabId>("basic");

  const assistant = useMemo(
    () => assistants?.find((a) => a.id === assistantId) ?? null,
    [assistants, assistantId]
  );

  if (assistantsLoading) {
    return (
      <Page title="Ассистент" className="mx-auto max-w-3xl">
        <Loader />
      </Page>
    );
  }

  if (!assistant) {
    return (
      <Page title="Ассистент не найден" className="mx-auto max-w-3xl">
        <p className="text-sm text-neutral-600">Нет ассистента с таким ID.</p>
        <button
          onClick={() => navigate("/assistants")}
          className="mt-3 text-sm underline text-neutral-700"
        >
          ← К списку
        </button>
      </Page>
    );
  }

  return (
    <Page
      title={assistant.name}
      description={
        <span className="font-mono text-xs">{assistant.model}</span>
      }
      className="mx-auto max-w-3xl"
    >
      {/* Back */}
      <div className="-mt-2">
        <Link
          to="/assistants"
          className="text-sm text-neutral-500 hover:text-neutral-700"
        >
          ← Все ассистенты
        </Link>
      </div>

      {/* Tabs */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Content */}
      {activeTab === "basic" && <BasicSection assistant={assistant} />}
      {activeTab === "agent" && (
        <AgentSection assistant={assistant} agents={agents} />
      )}
      {activeTab === "knowledge" && <KnowledgeSection assistant={assistant} />}
      {activeTab === "widget" && <WidgetSection assistant={assistant} />}
      {activeTab === "chat" && <ChatSection assistant={assistant} />}
      {activeTab === "usage" && <UsageSection />}
    </Page>
  );
}
