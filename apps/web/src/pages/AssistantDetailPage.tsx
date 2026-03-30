import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAssistants, usePatchAssistant } from "../api/assistants";
import { useAgents, useCreateAgent, usePatchAgent } from "../api/agents";
import { useCreateApiKey, usePatchApiKey, type CreateApiKeyResponse } from "../api/apiKeys";
import {
  useAddKnowledge,
  useAddKnowledgeUrl,
  useDeleteKnowledge,
  useKnowledgeList,
  uploadKnowledgeFiles,
  type KnowledgeItem,
} from "../api/knowledge";
import { queryKeys } from "../queryKeys";
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

function buildEmbedCode(apiKey: string): string {
  return `<script src="https://site-al.ru/widget.js" data-key="${apiKey}"><\/script>`;
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

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
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
            <label
              htmlFor="basic-prompt"
              className="block text-xs font-medium text-neutral-600"
            >
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

const AGENT_TEMPLATES = [
  {
    label: "Продажи",
    rules: `Ты — продающий менеджер. Помогай клиентам выбрать продукт.
- Активно предлагай решения исходя из потребностей
- Отвечай кратко и по делу, без воды
- Завершай ответ призывом к действию
- Используй дружелюбный, профессиональный тон`,
  },
  {
    label: "Поддержка",
    rules: `Ты — специалист техподдержки. Цель — решить проблему клиента.
- Уточняй детали проблемы перед ответом
- Давай пошаговые инструкции решения
- Будь терпелив и доброжелателен
- Если не можешь решить — сообщи, что передашь специалисту`,
  },
  {
    label: "FAQ",
    rules: `Ты — информационный помощник. Отвечай строго по базе знаний.
- Отвечай точно и кратко только по известным данным
- Если информации нет — честно сообщи об этом
- Не придумывай факты и не додумывай
- При вопросе вне базы: "Этот вопрос вне моей базы знаний"`,
  },
];

function AgentSection({ assistant, agents }: { assistant: Assistant; agents: Agent[] }) {
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
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-neutral-500">Шаблоны:</span>
                {AGENT_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setRules(t.rules)}
                    className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:bg-white hover:border-neutral-300 transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label
                htmlFor="agent-rules"
                className="block text-xs font-medium text-neutral-600"
              >
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
          Агент добавляет расширенную логику: правила поведения, сценарии, инструменты.
          Выберите шаблон или напишите свои правила.
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
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-neutral-500">Быстрые шаблоны:</span>
              {AGENT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    setAgentRules(t.rules);
                    if (!agentName) setAgentName(t.label);
                  }}
                  className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:bg-white hover:border-neutral-300 transition-colors"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label
              htmlFor="new-agent-rules"
              className="block text-xs font-medium text-neutral-600"
            >
              Правила поведения
            </label>
            <textarea
              id="new-agent-rules"
              rows={6}
              value={agentRules}
              onChange={(e) => setAgentRules(e.target.value)}
              placeholder="Добавьте правила поведения (например: продающий менеджер)"
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

// ─── FileGuideModal ───────────────────────────────────────────────────────────

const FILE_GUIDE_NAMES = [
  { file: "pricing.txt",          intent: "Цены",        color: "bg-blue-50 text-blue-700 border-blue-100" },
  { file: "objections.txt",       intent: "Возражения",  color: "bg-orange-50 text-orange-700 border-orange-100" },
  { file: "qualification_site.txt", intent: "Вопросы",   color: "bg-purple-50 text-purple-700 border-purple-100" },
  { file: "close.txt",            intent: "Закрытие",    color: "bg-green-50 text-green-700 border-green-100" },
];

const FILE_EXAMPLE = `Цены:

Лендинг (1 страница): 50 000 ₽
Корпоративный сайт:   150 000 ₽
Интернет-магазин:     от 200 000 ₽

Сроки: 2–4 недели.`;

const FILE_RULES = [
  "1 файл = 1 тема (не мешайте цены и возражения)",
  "Пишите кратко — AI читает весь файл целиком",
  "Конкретные цифры лучше расплывчатых фраз",
  "Имя файла определяет тему автоматически",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 transition-colors"
      title="Скопировать"
    >
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Скопировано
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4.5 9.5H3a1 1 0 01-1-1V3a1 1 0 011-1h5.5a1 1 0 011 1v1.5" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          Копировать
        </>
      )}
    </button>
  );
}

function FileGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 pt-5 pb-4 border-b border-neutral-100">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Как подготовить базу знаний</h2>
            <p className="text-xs text-neutral-500 mt-0.5">AI сам понимает тему файла по его названию</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* Block 1 — filename → intent */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Названия файлов
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {FILE_GUIDE_NAMES.map(({ file, intent, color }) => (
                <div
                  key={file}
                  className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5", color)}
                >
                  <span className="font-mono text-xs font-medium">{file}</span>
                  <span className="text-xs ml-2 shrink-0">→ {intent}</span>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-xs text-neutral-500">
              Назовите файл точно как показано — AI автоматически привяжет его к нужному этапу продаж.
            </p>
          </section>

          {/* Block 2 — example */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Пример — pricing.txt
              </h3>
              <CopyButton text={FILE_EXAMPLE} />
            </div>
            <pre className="rounded-lg bg-neutral-950 px-4 py-3.5 text-xs leading-relaxed text-neutral-200 overflow-x-auto whitespace-pre-wrap">
              {FILE_EXAMPLE}
            </pre>
          </section>

          {/* Block 3 — rules */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Правила
            </h3>
            <ul className="space-y-2">
              {FILE_RULES.map((rule, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-700">
                  <span className="mt-0.5 shrink-0 h-5 w-5 rounded-full bg-neutral-100 flex items-center justify-center text-xs font-semibold text-neutral-500">
                    {i + 1}
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          </section>

          {/* Block 4 — how it works */}
          <section className="rounded-xl bg-neutral-950 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">⚡</span>
              <div>
                <p className="text-sm font-medium text-white">Как работает</p>
                <p className="mt-1 text-xs text-neutral-400 leading-relaxed">
                  Когда клиент спрашивает о ценах — AI находит <span className="text-neutral-200 font-mono">pricing.txt</span>{" "}
                  и отвечает по нему. Когда возражает — использует <span className="text-neutral-200 font-mono">objections.txt</span>.
                  Название файла = тема для AI.
                </p>
              </div>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Понятно, начать загрузку
          </button>
        </div>
      </div>
    </div>
  );
}

type KInputTab = "text" | "file" | "url";

const K_TABS: { id: KInputTab; label: string }[] = [
  { id: "text", label: "📝 Текст" },
  { id: "file", label: "📄 Файлы" },
  { id: "url", label: "🌐 Ссылка" },
];

function StatusBadge({ status }: { status: KnowledgeItem["status"] }) {
  const conf = {
    processing: { bg: "bg-amber-50 text-amber-700", label: "обработка…" },
    ready: { bg: "bg-green-50 text-green-700", label: "готово" },
    failed: { bg: "bg-red-50 text-red-600", label: "ошибка" },
  }[status] ?? { bg: "bg-neutral-100 text-neutral-500", label: status };

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", conf.bg)}>
      {conf.label}
    </span>
  );
}

const INTENT_LABEL: Record<string, { label: string; bg: string }> = {
  pricing:            { label: "Цены",        bg: "bg-blue-50 text-blue-700 border-blue-200" },
  objection:          { label: "Возражения",  bg: "bg-orange-50 text-orange-700 border-orange-200" },
  qualification_site: { label: "Вопросы",     bg: "bg-purple-50 text-purple-700 border-purple-200" },
  close:              { label: "Закрытие",    bg: "bg-green-50 text-green-700 border-green-200" },
};

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return null;
  const conf = INTENT_LABEL[intent] ?? { label: intent, bg: "bg-neutral-100 text-neutral-500 border-neutral-200" };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", conf.bg)}>
      FSM · {conf.label}
    </span>
  );
}

const SOURCE_LABEL: Record<string, { label: string; icon: string; bg: string }> = {
  fsm:    { label: "Этап диалога",  icon: "⚡", bg: "bg-green-50 text-green-700" },
  intent: { label: "База знаний",   icon: "🎯", bg: "bg-blue-50 text-blue-700" },
  rag:    { label: "База знаний",   icon: "🔍", bg: "bg-neutral-100 text-neutral-600" },
  db:     { label: "База знаний",   icon: "📚", bg: "bg-neutral-100 text-neutral-600" },
};

type UploadFileRow = {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
};

function KnowledgeSection({ assistant }: { assistant: Assistant }) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [inputTab, setInputTab] = useState<KInputTab>("text");

  // Text
  const [text, setText] = useState("");
  const addText = useAddKnowledge();

  // File (multi)
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadFileRow[]>([]);
  const [showFileGuide, setShowFileGuide] = useState(false);

  // URL
  const [urlInput, setUrlInput] = useState("");
  const addUrl = useAddKnowledgeUrl(assistant.id);

  // List
  const {
    data: items = [],
    isLoading: listLoading,
  } = useKnowledgeList(assistant.id);
  const deleteKnowledge = useDeleteKnowledge(assistant.id);

  async function handleAddText(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    await addText.mutateAsync({ assistantId: assistant.id, content: t });
    setText("");
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list?.length) return;
    const files = Array.from(list);
    console.log("[upload] e.target.files.length =", list.length, files.map((f) => f.name));
    setUploadErr(null);
    setUploadDone(false);
    setUploading(true);
    setUploadRows(files.map((f) => ({ name: f.name, status: "uploading" as const })));
    try {
      const { items, errors } = await uploadKnowledgeFiles(assistant.id, files, accessToken);
      const errByName = new Map(errors.map((x) => [x.sourceName, x.error]));
      const okNames = new Set(
        items.map((it) => it.sourceName).filter((n): n is string => Boolean(n))
      );
      setUploadRows(
        files.map((f) => {
          const err = errByName.get(f.name);
          if (err) return { name: f.name, status: "error" as const, error: err };
          if (okNames.has(f.name)) return { name: f.name, status: "done" as const };
          return {
            name: f.name,
            status: "error" as const,
            error: "Не обработано",
          };
        })
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.knowledge.byAssistant(assistant.id),
      });
      if (items.length > 0) setUploadDone(true);
      if (errors.length > 0) {
        setUploadErr(
          errors.length === files.length
            ? errors.map((x) => `${x.sourceName}: ${x.error}`).join(" · ")
            : `Часть файлов с ошибкой: ${errors.map((x) => `${x.sourceName}: ${x.error}`).join(" · ")}`
        );
      }
    } catch (err) {
      setUploadRows(
        files.map((f) => ({
          name: f.name,
          status: "error" as const,
          error: err instanceof Error ? err.message : "Ошибка загрузки",
        }))
      );
      setUploadErr(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleAddUrl(e: FormEvent) {
    e.preventDefault();
    const u = urlInput.trim();
    if (!u) return;
    await addUrl.mutateAsync({ assistantId: assistant.id, url: u });
    setUrlInput("");
  }

  const typeIcon: Record<string, string> = {
    file: "📄",
    url: "🌐",
    text: "📝",
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">База знаний</h3>
        <span className="text-xs text-neutral-400">{items.length} записей</span>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Input area */}
        <div className="rounded-xl border border-neutral-200 p-4">
          {/* Sub-tab bar */}
          <div className="mb-4 flex gap-1 rounded-lg bg-neutral-100 p-1">
            {K_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setInputTab(t.id)}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                  inputTab === t.id
                    ? "bg-white text-neutral-900 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Text */}
          {inputTab === "text" && (
            <form onSubmit={(e) => void handleAddText(e)} className="space-y-3">
              <textarea
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Вставьте текст, статью, FAQ или инструкцию…"
                className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                required
              />
              <div className="flex items-center gap-3">
                <Button type="submit" loading={addText.isPending}>
                  Добавить текст
                </Button>
                {addText.isError && (
                  <span className="text-sm text-red-600">
                    {addText.error instanceof Error ? addText.error.message : "Ошибка"}
                  </span>
                )}
              </div>
            </form>
          )}

          {/* File */}
          {inputTab === "file" && (
            <div className="space-y-3">
              {/* Guide modal */}
              {showFileGuide && <FileGuideModal onClose={() => setShowFileGuide(false)} />}

              {/* Info row */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">
                  Можно выбрать <strong>несколько файлов</strong> сразу (до 64, по 10 MB каждый).
                  Форматы: <strong>.txt</strong>, <strong>.pdf</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setShowFileGuide(true)}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="text-neutral-400">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
                  </svg>
                  Как подготовить файлы
                </button>
              </div>

              <label
                htmlFor="knowledge-file"
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-200 p-6 transition-colors",
                  uploading ? "opacity-60 cursor-not-allowed" : "hover:border-neutral-400 hover:bg-neutral-50"
                )}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M10 3v10M5 8l5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400"/>
                  <path d="M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-neutral-400"/>
                </svg>
                <span className="text-sm text-neutral-500">
                  {uploading ? "Отправка на сервер…" : "Выбрать файлы (кликните)"}
                </span>
              </label>
              <input
                ref={fileRef}
                id="knowledge-file"
                type="file"
                multiple
                accept=".txt,.pdf,text/plain,application/pdf"
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
                disabled={uploading}
              />
              {uploading && uploadRows.length > 0 && (
                <div className="space-y-1 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                  <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full w-full animate-pulse rounded-full bg-neutral-400" />
                  </div>
                  <p className="text-xs font-medium text-neutral-600">
                    Загрузка {uploadRows.length} файл(ов)…
                  </p>
                </div>
              )}
              {!uploading && uploadRows.length > 0 && (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-neutral-200 p-3 text-sm">
                  {uploadRows.map((row, idx) => (
                    <li
                      key={`${idx}-${row.name}`}
                      className="flex items-start justify-between gap-2 border-b border-neutral-100 pb-1.5 last:border-0 last:pb-0"
                    >
                      <span className="min-w-0 truncate text-neutral-800" title={row.name}>
                        {row.name}
                      </span>
                      <span className="shrink-0 text-xs text-right max-w-[55%]">
                        {row.status === "done" && (
                          <span className="text-green-600">в очереди</span>
                        )}
                        {row.status === "error" && (
                          <span className="text-red-600 line-clamp-2" title={row.error}>
                            {row.error ?? "ошибка"}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {uploadErr && <p className="text-sm text-red-600">{uploadErr}</p>}
              {uploadDone && !uploading && (
                <p className="text-sm text-green-600">
                  ✓ Файлы приняты, идёт обработка в фоне. Статус обновится в списке ниже.
                </p>
              )}
            </div>
          )}

          {/* URL */}
          {inputTab === "url" && (
            <form onSubmit={(e) => void handleAddUrl(e)} className="space-y-3">
              <Input
                id="knowledge-url"
                label="URL страницы"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/page"
                type="url"
                required
              />
              <div className="flex items-center gap-3">
                <Button type="submit" loading={addUrl.isPending}>
                  Загрузить страницу
                </Button>
                {addUrl.isError && (
                  <span className="text-sm text-red-600">
                    {addUrl.error instanceof Error ? addUrl.error.message : "Ошибка"}
                  </span>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Knowledge list */}
        {listLoading && <Loader />}
        {!listLoading && items.length === 0 && (
          <p className="py-4 text-center text-sm text-neutral-400">
            База знаний пуста. Добавьте текст, файл или ссылку выше.
          </p>
        )}
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3"
              >
                <span className="mt-0.5 text-base leading-none">
                  {typeIcon[item.type] ?? "📎"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-800">
                    {item.sourceName ?? `Текст ${item.id.slice(0, 8)}`}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">
                    {item.contentPreview}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <IntentBadge intent={item.intent} />
                    {item.chunkCount > 0 && (
                      <span className="text-xs text-neutral-400">
                        {item.chunkCount} чанков
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteKnowledge.mutate(item.id)}
                  disabled={deleteKnowledge.isPending}
                  className="shrink-0 rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                  title="Удалить"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 4h10M5 4V2h4v2M5.5 6v5M8.5 6v5M3 4l.7 8h6.6L11 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Widget ──────────────────────────────────────────────────────────

function WidgetSection({ assistant }: { assistant: Assistant }) {
  const createKey = useCreateApiKey();
  const patchKey = usePatchApiKey();
  const [embedCode, setEmbedCode] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);

  // Domain management state
  const [domains, setDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [domainsSaved, setDomainsSaved] = useState(false);

  // Auto-create key on first mount
  useEffect(() => {
    void generateKey();
  }, [assistant.id]);

  async function generateKey() {
    setCreating(true);
    setCreateError(null);
    setEmbedCode(null);
    setKeyId(null);
    setDomains([]);
    try {
      const res = (await createKey.mutateAsync({
        assistantId: assistant.id,
        name: `widget:${assistant.name}`,
      })) as CreateApiKeyResponse;
      setKeyId(res.id);
      setDomains(res.allowedDomains ?? []);
      setEmbedCode(buildEmbedCode(res.key));
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Ошибка создания ключа");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!embedCode) return;
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      codeRef.current?.select();
    }
  }

  function addDomain() {
    const d = domainInput.trim().toLowerCase();
    if (!d || domains.includes(d)) return;
    setDomains((prev) => [...prev, d]);
    setDomainInput("");
  }

  function removeDomain(d: string) {
    setDomains((prev) => prev.filter((x) => x !== d));
  }

  async function saveDomains() {
    if (!keyId) return;
    await patchKey.mutateAsync({ id: keyId, allowedDomains: domains });
    setDomainsSaved(true);
    setTimeout(() => setDomainsSaved(false), 2500);
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-neutral-800">Виджет для сайта</h3>
      </CardHeader>
      <CardContent className="space-y-4">
        {creating && (
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Loader className="h-4 w-4" />
            Генерация API ключа…
          </div>
        )}

        {createError && !creating && (
          <div className="space-y-3">
            <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              {createError}
            </p>
            <Button variant="secondary" onClick={() => void generateKey()} loading={creating}>
              Попробовать снова
            </Button>
          </div>
        )}

        {embedCode && !creating && (
          <>
            <p className="text-sm text-neutral-600">
              Вставьте одну строку перед{" "}
              <code className="rounded bg-neutral-100 px-1 text-xs">&lt;/body&gt;</code>:
            </p>
            <textarea
              ref={codeRef}
              readOnly
              value={embedCode}
              rows={2}
              className="w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              onClick={() => codeRef.current?.select()}
            />
            <div className="flex items-center gap-3">
              <Button onClick={() => void handleCopy()}>
                {copied ? "✓ Скопировано!" : "Скопировать"}
              </Button>
              <Button variant="secondary" onClick={() => void generateKey()} loading={creating}>
                Новый ключ
              </Button>
            </div>
            <p className="text-xs text-neutral-400">
              Сохраните ключ — он показывается только здесь. При нажатии «Новый ключ»
              предыдущий ключ перестанет работать.
            </p>

            {/* ─── Domain management ─────────────────────────────────────────── */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
              <div>
                <h4 className="text-sm font-medium text-neutral-700">Разрешённые домены</h4>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Если список пуст — виджет работает с любого домена.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addDomain();
                    }
                  }}
                  placeholder="example.com"
                  className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                />
                <Button variant="secondary" onClick={addDomain}>
                  Добавить
                </Button>
              </div>
              {domains.length > 0 && (
                <div className="space-y-1.5">
                  {domains.map((d) => (
                    <div
                      key={d}
                      className="flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5"
                    >
                      <code className="text-xs text-neutral-700">{d}</code>
                      <button
                        type="button"
                        onClick={() => removeDomain(d)}
                        className="ml-2 text-neutral-400 hover:text-red-500"
                        aria-label="Удалить домен"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {keyId && (
                <div className="flex items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => void saveDomains()}
                    loading={patchKey.isPending}
                  >
                    Сохранить домены
                  </Button>
                  {domainsSaved && (
                    <span className="text-xs font-medium text-green-600">✓ Сохранено</span>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Section: Chat ────────────────────────────────────────────────────────────

type ChatMsg = {
  id: string;
  role: "user" | "ai";
  text: string;
  knowledgeSource?: string;
  fsmStage?: string;
};

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

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
              knowledgeSource?: string;
              fsmStage?: string;
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
            // "done" event carries knowledgeSource + fsmStage
            if (payload.knowledgeSource != null) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, knowledgeSource: payload.knowledgeSource, fsmStage: payload.fsmStage }
                    : m
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
          {messages.map((m) => {
            const srcConf = m.role === "ai" && m.knowledgeSource
              ? SOURCE_LABEL[m.knowledgeSource] ?? null
              : null;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}
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
                {srcConf && (
                  <span className={cn("mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs", srcConf.bg)}>
                    <span>{srcConf.icon}</span>
                    Ответ основан на: {srcConf.label}
                    {m.knowledgeSource === "fsm" && m.fsmStage && (
                      <span className="ml-1 opacity-70">
                        ({INTENT_LABEL[m.fsmStage]?.label ?? m.fsmStage})
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
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
          <Button
            onClick={() => void send()}
            loading={streaming}
            disabled={!input.trim()}
          >
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
        <h3 className="text-sm font-semibold text-neutral-800">
          Использование (организация)
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
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
      description={<span className="font-mono text-xs">{assistant.model}</span>}
      className="mx-auto max-w-3xl"
    >
      <div className="-mt-2">
        <Link
          to="/assistants"
          className="text-sm text-neutral-500 hover:text-neutral-700"
        >
          ← Все ассистенты
        </Link>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

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
