import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAssistants, useAutoAgent, useRefineAgent, usePatchAssistant } from "../api/assistants";
import { useAgents, useAutoGenerateAgent, useCreateAgent, usePatchAgent } from "../api/agents";
import { useCreateApiKey, usePatchApiKey, type CreateApiKeyResponse } from "../api/apiKeys";
import {
  useAddKnowledge,
  useAddKnowledgeUrl,
  useDeleteKnowledge,
  useKnowledgeList,
  useGetKnowledge,
  usePatchKnowledge,
  uploadKnowledgeFiles,
  type KnowledgeItem,
  type KnowledgeItemFull,
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
import type { Assistant, Agent, AutoAgentResult } from "../api/types";

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

// ─── Presets ─────────────────────────────────────────────────────────────────
// Общие правила (только русский, лимит длины, стоп-слова, FSM-хинт) уже жёстко
// прибиты на сервере в apps/api/src/modules/avito/avito.prompt.js. Здесь —
// только «персона и тон голоса», чтобы можно было переопределить под каждую
// студию/продавца без дублирования серверных ограничений.
const AVITO_SALES_RU_PRESET =
  [
    "Ты — менеджер digital-студии neeklo.studio в чате Avito.",
    "",
    "Говоришь только на русском языке. Если клиент пишет на другом — всё равно отвечаешь по-русски.",
    "",
    "Тон:",
    "— как живой человек, а не бот",
    "— по-деловому, но без канцелярита",
    "— коротко: 1–4 предложения, один вопрос за раз",
    "— можно лёгкий комплимент («хороший вопрос», «понял вас»)",
    "— можно лёгкую шутку, но без фанатизма",
    "",
    "Что делаешь:",
    "— выясняешь задачу клиента: что нужно сделать, для кого, когда",
    "— отвечаешь по услугам и ценам ТОЛЬКО из базы знаний",
    "— если точной цены нет в базе — называешь диапазон и предлагаешь уточнить у менеджера",
    "— если не знаешь ответа — честно говоришь «не знаю точно» и предлагаешь передать менеджеру",
    "— при получении номера телефона или запроса позвонить — передаёшь менеджеру",
    "",
    "Чего НЕ делаешь:",
    "— не выдумываешь факты, цены, сроки",
    "— не обещаешь конкретные сроки без данных из базы",
    "— не представляешься ботом/AI, если напрямую не спросили",
    "— не используешь нумерованные списки и буллиты",
    "— не пишешь «безусловно», «конечно же», «я как AI…», «рад вам помочь»",
    "",
    "Фразы при переключении на менеджера:",
    "— «Понял, передаю менеджеру — он напишет в ближайшее время.»",
    "— «Хороший вопрос, тут лучше менеджер ответит точнее. Передаю, он скоро напишет.»",
  ].join("\n");

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

// ─── PromptGuideModal ─────────────────────────────────────────────────────────

const PROMPT_EXAMPLE = `Ты — менеджер студии Neeklo.
Отвечай кратко, без воды.
Всегда задавай один уточняющий вопрос.
Веди клиента к покупке.`;

const PROMPT_BLOCKS = [
  {
    title: "Роль",
    icon: "👤",
    tip: "Назови кто ты и для чего",
    example: "Ты — менеджер продаж веб-студии.",
    color: "bg-blue-50 border-blue-100",
    textColor: "text-blue-800",
  },
  {
    title: "Стиль",
    icon: "✍️",
    tip: "Как отвечать: тон, длина",
    example: "Отвечай коротко и уверенно.",
    color: "bg-purple-50 border-purple-100",
    textColor: "text-purple-800",
  },
  {
    title: "Поведение",
    icon: "🎯",
    tip: "Что делать в каждом ответе",
    example: "Задавай 1 вопрос. Веди к сделке.",
    color: "bg-green-50 border-green-100",
    textColor: "text-green-800",
  },
];

const PROMPT_ERRORS = [
  { text: "\"ты AI помощник\" — обезличивает, клиент не доверяет" },
  { text: "длинные блоки текста — AI теряет фокус" },
  { text: "инструкции без глагола — \"дружелюбный тон\" вместо \"общайся дружелюбно\"" },
];

function PromptGuideModal({ onUseExample, onClose }: { onUseExample: (t: string) => void; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(PROMPT_EXAMPLE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function handleUse() {
    onUseExample(PROMPT_EXAMPLE);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 pt-5 pb-4 border-b border-neutral-100">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">Как составить системный промпт</h2>
            <p className="text-xs text-neutral-500 mt-0.5">3 блока — и AI работает как настоящий менеджер</p>
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

          {/* Blocks */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Структура промпта
            </h3>
            <div className="space-y-2">
              {PROMPT_BLOCKS.map((b) => (
                <div key={b.title} className={cn("rounded-xl border p-4", b.color)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base">{b.icon}</span>
                    <span className={cn("text-sm font-semibold", b.textColor)}>{b.title}</span>
                    <span className="ml-auto text-xs text-neutral-500">{b.tip}</span>
                  </div>
                  <p className="font-mono text-xs text-neutral-700 bg-white/70 rounded-lg px-3 py-2">
                    {b.example}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Example */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Готовый пример
              </h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 transition-colors"
              >
                {copied ? (
                  <><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5L5.5 10.5L11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Скопировано</>
                ) : (
                  <><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M4.5 9.5H3a1 1 0 01-1-1V3a1 1 0 011-1h5.5a1 1 0 011 1v1.5" stroke="currentColor" strokeWidth="1.2"/></svg>Копировать</>
                )}
              </button>
            </div>
            <pre className="rounded-lg bg-neutral-950 px-4 py-4 text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap">
              {PROMPT_EXAMPLE}
            </pre>
            <button
              onClick={handleUse}
              className="mt-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-100 transition-colors"
            >
              Вставить в промпт →
            </button>
          </section>

          {/* Errors */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
              Частые ошибки
            </h3>
            <ul className="space-y-2">
              {PROMPT_ERRORS.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-neutral-700">
                  <span className="mt-0.5 shrink-0 text-red-500">✕</span>
                  {e.text}
                </li>
              ))}
            </ul>
          </section>

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-4">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 transition-colors"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AutoAgentModal — human-readable 4-block preview ─────────────────────────

function SpinIcon() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">
      {children}
    </h3>
  );
}

function AutoAgentModal({
  assistant,
  onClose,
  onApply,
}: {
  assistant: Assistant;
  onClose: () => void;
  onApply: (result: AutoAgentResult, createKnowledge: boolean) => void;
}) {
  const autoAgent = useAutoAgent();
  const refineAgent = useRefineAgent();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<AutoAgentResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [createKnowledge, setCreateKnowledge] = useState(true);

  const isGenerating = autoAgent.isPending;
  const isRefining = refineAgent.isPending;
  const isBusy = isGenerating || isRefining;

  async function handleGenerate() {
    if (!description.trim()) return;
    setResult(null);
    setApplied(false);
    setShowRefine(false);
    const r = await autoAgent.mutateAsync({ description, assistantId: assistant.id });
    setResult(r);
  }

  async function handleRefine() {
    if (!result || !refineInstruction.trim()) return;
    setApplied(false);
    const r = await refineAgent.mutateAsync({
      config: result.config,
      systemPrompt: result.systemPrompt,
      instruction: refineInstruction,
      assistantId: assistant.id,
    });
    setResult(r);
    setShowRefine(false);
    setRefineInstruction("");
  }

  function handleApply() {
    if (!result) return;
    onApply(result, createKnowledge);
    setApplied(true);
    setTimeout(onClose, 800);
  }

  const ex = result?.explanation;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-6 pt-5 pb-4 border-b border-neutral-100">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">⚡ Авто-настройка ассистента</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              AI создаст промпт и конфигурацию под ваш бизнес за несколько секунд
            </p>
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

          {/* ── Input ─────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1.5">
              Опишите ваш бизнес
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: Я занимаюсь натяжными потолками, хочу получать заявки с сайта"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 resize-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isBusy || !description.trim()}
                className="flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? <><SpinIcon /> Генерирую…</> : <>⚡ Сгенерировать</>}
              </button>
              {result && !isGenerating && (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={isBusy}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                >
                  Перегенерировать
                </button>
              )}
            </div>
            {autoAgent.isError && (
              <p className="mt-2 text-xs text-red-600">
                {autoAgent.error instanceof Error ? autoAgent.error.message : "Ошибка генерации"}
              </p>
            )}
          </div>

          {/* ── Loading state ─────────────────────────────────────────────── */}
          {isGenerating && (
            <div className="flex items-center gap-3 rounded-xl bg-neutral-50 px-5 py-6">
              <SpinIcon />
              <div>
                <p className="text-sm font-medium text-neutral-700">Анализирую ваш бизнес…</p>
                <p className="text-xs text-neutral-500 mt-0.5">Обычно занимает 3–10 секунд</p>
              </div>
            </div>
          )}

          {/* ── PREVIEW ───────────────────────────────────────────────────── */}
          {ex && result && !isGenerating && (
            <div className="space-y-5">

              {/* Block 1 — Что получишь */}
              <div className="rounded-xl border border-neutral-100 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
                <SectionTitle>🔥 Что получишь</SectionTitle>
                <p className="text-sm text-neutral-800 leading-relaxed mb-4">{ex.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/80 border border-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    📍 {ex.meta.stagesCount} этапов в воронке
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/80 border border-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    💬 {ex.meta.intentsCount} намерений
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/80 border border-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    🧠 {ex.meta.memoryFieldsCount} полей памяти
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/80 border border-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                    ✂️ макс. {ex.meta.maxSentences} предложения
                  </span>
                </div>
                <div className="mt-4 rounded-lg bg-neutral-900 px-4 py-3">
                  <p className="text-xs font-medium text-neutral-400 mb-1">Системный промпт</p>
                  <p className="text-xs leading-relaxed text-neutral-200">{result.systemPrompt}</p>
                </div>
              </div>

              {/* Block 2 — Как работает */}
              <div className="rounded-xl border border-neutral-100 bg-white p-5">
                <SectionTitle>🔥 Как работает</SectionTitle>
                <div className="relative">
                  {/* timeline line */}
                  <div className="absolute left-5 top-6 bottom-2 w-px bg-neutral-100" />
                  <div className="space-y-3">
                    {ex.funnelDescription.map((step) => (
                      <div key={step.stage} className="relative flex items-start gap-4 pl-1">
                        <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border-2 border-neutral-100 text-base">
                          {step.icon}
                        </div>
                        <div className="flex-1 pt-1.5 pb-2">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-neutral-900">{step.label}</span>
                            <span className="text-xs text-neutral-400">#{step.step}</span>
                          </div>
                          <p className="text-xs text-neutral-500 leading-relaxed">{step.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Intent triggers (compact) */}
                <div className="mt-4 pt-4 border-t border-neutral-50">
                  <p className="text-xs font-medium text-neutral-500 mb-2">Триггеры ответов</p>
                  <div className="space-y-2">
                    {ex.intentsDescription.map((intent) => (
                      <div key={intent.intent} className="flex items-start gap-2">
                        <span className="text-sm">{intent.icon}</span>
                        <div>
                          <span className="text-xs font-medium text-neutral-700">{intent.label}: </span>
                          <span className="text-xs text-neutral-500">
                            {intent.triggers.slice(0, 4).join(", ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Block 3 — Что запоминает */}
              <div className="rounded-xl border border-neutral-100 bg-white p-5">
                <SectionTitle>🔥 Что запоминает</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  {ex.memoryDescription.map((m) => (
                    <div key={m.field} className="flex items-start gap-3 rounded-lg bg-green-50 border border-green-100 px-3 py-3">
                      <span className="text-base mt-0.5">{m.icon}</span>
                      <div>
                        <p className="text-xs font-semibold text-green-900">{m.label}</p>
                        <p className="text-xs text-green-700 mt-0.5 leading-snug">{m.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Block 4 — Симуляция диалога */}
              <div className="rounded-xl border border-neutral-100 bg-white p-5">
                <SectionTitle>🧠 Как будет работать ассистент</SectionTitle>
                <p className="mb-4 text-xs text-neutral-500 leading-relaxed">
                  Симуляция показывает как AI проводит клиента через этапы воронки — какой интент определяет и из какого этапа отвечает.
                </p>
                <div className="space-y-4">
                  {ex.exampleDialog.map((msg, i) => (
                    <div key={i} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                      {/* Stage/intent meta — above AI messages */}
                      {msg.role === "ai" && msg.stage && (
                        <div className="mb-1.5 flex items-center gap-1.5">
                          {/* Stage badge */}
                          <span className="flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                            {(STAGE_LABEL_MAP[msg.stage] ?? { icon: "📍" }).icon}{" "}
                            {msg.stageLabel ?? msg.stage}
                          </span>
                          {/* Intent badge */}
                          {msg.intent && (
                            <span className="flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs text-blue-700">
                              🎯 {msg.intentLabel ?? msg.intent}
                            </span>
                          )}
                        </div>
                      )}
                      {/* Stage label above user messages */}
                      {msg.role === "user" && msg.stage && (
                        <p className="mb-1 text-xs text-neutral-400">
                          {(STAGE_LABEL_MAP[msg.stage] ?? { icon: "💬" }).icon} Клиент на этапе: {STAGE_LABEL_MAP[msg.stage]?.label ?? msg.stage}
                        </p>
                      )}
                      <div className={cn(
                        "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "bg-neutral-900 text-white rounded-br-sm"
                          : "bg-neutral-100 text-neutral-800 rounded-bl-sm"
                      )}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Block 5 — База знаний (suggestions) */}
              {ex.knowledgeSuggestions && ex.knowledgeSuggestions.length > 0 && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
                  <SectionTitle>📚 Рекомендуемая база знаний</SectionTitle>
                  <p className="mb-3 text-xs text-neutral-500 leading-relaxed">
                    AI определил темы для базы знаний. При нажатии «Применить» мы создадим заготовки — вам останется только заполнить их содержанием.
                  </p>
                  <div className="space-y-2">
                    {ex.knowledgeSuggestions.map((s) => (
                      <div key={s.intent} className="rounded-lg border border-blue-100 bg-white px-4 py-3">
                        <p className="text-xs font-semibold text-neutral-800 mb-0.5">{s.title}</p>
                        <p className="text-xs text-neutral-500 mb-1.5">{s.hint}</p>
                        <pre className="whitespace-pre-wrap rounded-md bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 border border-neutral-100">
                          {s.example}
                        </pre>
                      </div>
                    ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={createKnowledge}
                      onChange={(e) => setCreateKnowledge(e.target.checked)}
                      className="rounded border-neutral-300"
                    />
                    Создать заготовки базы знаний при применении
                  </label>
                </div>
              )}

              {/* ✏️ Улучшить */}
              <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRefine((v) => !v)}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  <span>✏️ Улучшить конфигурацию</span>
                  <svg
                    width="14" height="14" viewBox="0 0 14 14" fill="none"
                    className={cn("transition-transform", showRefine && "rotate-180")}
                  >
                    <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showRefine && (
                  <div className="px-5 pb-5 border-t border-neutral-100 pt-4 space-y-3">
                    <p className="text-xs text-neutral-500">
                      Опишите что изменить — например: «сделай агрессивнее», «добавь возражение по срокам», «сократи воронку до 3 этапов»
                    </p>
                    <textarea
                      rows={2}
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      placeholder="Например: сделай агрессивнее, добавь акцент на срочность"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleRefine()}
                        disabled={isBusy || !refineInstruction.trim()}
                        className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isRefining ? <><SpinIcon /> Улучшаю…</> : <>✨ Применить улучшение</>}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowRefine(false); setRefineInstruction(""); }}
                        className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors"
                      >
                        Отмена
                      </button>
                    </div>
                    {refineAgent.isError && (
                      <p className="text-xs text-red-600">
                        {refineAgent.error instanceof Error ? refineAgent.error.message : "Ошибка улучшения"}
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        {result && !isGenerating && (
          <div className="sticky bottom-0 bg-white border-t border-neutral-100 px-6 py-4 flex gap-3">
            <button
              onClick={handleApply}
              disabled={applied || isBusy}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 transition-colors"
            >
              {applied ? "✓ Применено" : "Применить →"}
            </button>
          </div>
        )}
      </div>
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
  const [showPromptGuide, setShowPromptGuide] = useState(false);
  const [showAutoAgent, setShowAutoAgent] = useState(false);

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

  const addKnowledge = useAddKnowledge();

  async function handleApplyAutoAgent(result: AutoAgentResult, createKnowledge: boolean) {
    setSystemPrompt(result.systemPrompt);
    await patchAssistant.mutateAsync({
      id: assistant.id,
      systemPrompt: result.systemPrompt,
      config: result.config as Record<string, unknown>,
    });
    if (createKnowledge && result.explanation?.knowledgeSuggestions?.length) {
      for (const s of result.explanation.knowledgeSuggestions) {
        try {
          await addKnowledge.mutateAsync({
            assistantId: assistant.id,
            content: `# ${s.title}\n\n${s.hint}\n\n${s.example}`,
          });
        } catch {
          // Non-critical — continue with others
        }
      }
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <Card>
      {showAutoAgent && (
        <AutoAgentModal
          assistant={assistant}
          onClose={() => setShowAutoAgent(false)}
          onApply={(r, ck) => void handleApplyAutoAgent(r, ck)}
        />
      )}
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">Основные настройки</h3>
          <button
            type="button"
            onClick={() => setShowAutoAgent(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-300 transition-colors"
          >
            ⚡ Авто-настроить
          </button>
        </div>
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
            {showPromptGuide && (
              <PromptGuideModal
                onUseExample={(t) => setSystemPrompt(t)}
                onClose={() => setShowPromptGuide(false)}
              />
            )}
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <label
                htmlFor="basic-prompt"
                className="text-xs font-medium text-neutral-600"
              >
                Системный промпт
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    if (systemPrompt.trim().length > 0 && !window.confirm(
                      "Заменить текущий системный промпт шаблоном «Avito-продажник (RU)»?"
                    )) return;
                    setSystemPrompt(AVITO_SALES_RU_PRESET);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  title="Живой менеджер, только русский язык, короткие ответы — готовый шаблон из ТЗ"
                >
                  🇷🇺 Шаблон: Avito-продажник
                </button>
                <button
                  type="button"
                  onClick={() => setShowPromptGuide(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-neutral-400">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
                  </svg>
                  Как составить
                </button>
              </div>
            </div>
            <textarea
              id="basic-prompt"
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
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

        {/* Config view — shown when assistant has a saved config */}
        {Boolean(assistant.config) && (
          <AssistantConfigView config={assistant.config as AssistantConfig} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── AssistantConfigView ──────────────────────────────────────────────────────

type AssistantConfig = {
  funnel?: string[];
  intents?: Record<string, string[]>;
  memory?: string[];
  stageIntents?: Record<string, string>;
  validation?: { maxSentences?: number; questions?: number };
};

const STAGE_LABEL_MAP: Record<string, { label: string; icon: string }> = {
  greeting:      { label: "Приветствие", icon: "👋" },
  qualification: { label: "Квалификация", icon: "🔍" },
  offer:         { label: "Предложение", icon: "💎" },
  objection:     { label: "Возражение", icon: "🛡" },
  close:         { label: "Закрытие", icon: "🤝" },
};

const INTENT_LABEL_MAP: Record<string, string> = {
  pricing:            "💰 Цены",
  objection:          "🛡 Возражения",
  qualification_site: "🔍 Квалификация",
  close:              "🤝 Закрытие",
  greeting:           "👋 Приветствие",
};

const MEMORY_LABEL_MAP: Record<string, { label: string; icon: string }> = {
  budget:      { label: "Бюджет", icon: "💰" },
  projectType: { label: "Тип проекта", icon: "📦" },
  timeline:    { label: "Срок", icon: "⏱" },
  contactName: { label: "Имя", icon: "👤" },
  phone:       { label: "Телефон", icon: "📞" },
};

function AssistantConfigView({ config }: { config: AssistantConfig }) {
  const funnel = Array.isArray(config.funnel) ? config.funnel : [];
  const intents = config.intents && typeof config.intents === "object" ? config.intents : {};
  const memory = Array.isArray(config.memory) ? config.memory : [];
  const validation = config.validation ?? {};

  if (funnel.length === 0 && Object.keys(intents).length === 0 && memory.length === 0) return null;

  return (
    <div className="mt-5 rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/60 to-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-indigo-600">
        ⚡ Конфигурация ассистента
      </p>

      {/* Funnel */}
      {funnel.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Воронка продаж</p>
          <div className="flex flex-wrap items-center gap-1">
            {funnel.map((stage, i) => {
              const s = STAGE_LABEL_MAP[stage] ?? { label: stage, icon: "▸" };
              return (
                <div key={stage} className="flex items-center gap-1">
                  <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-800">
                    {s.icon} {s.label}
                  </span>
                  {i < funnel.length - 1 && (
                    <span className="text-xs text-neutral-400">→</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Intents */}
      {Object.keys(intents).length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Интенты</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(intents).map((intent) => (
              <span
                key={intent}
                className="rounded-full border border-neutral-200 bg-white px-2.5 py-0.5 text-xs font-medium text-neutral-700"
              >
                {INTENT_LABEL_MAP[intent] ?? intent}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Memory */}
      {memory.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Что запоминает</p>
          <div className="flex flex-wrap gap-1.5">
            {memory.map((field) => {
              const m = MEMORY_LABEL_MAP[field] ?? { label: field, icon: "📌" };
              return (
                <span
                  key={field}
                  className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
                >
                  {m.icon} {m.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Validation */}
      {(validation.maxSentences != null || validation.questions != null) && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Правила ответа</p>
          <div className="flex flex-wrap gap-1.5">
            {validation.maxSentences != null && (
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                ✂️ макс. {validation.maxSentences} предл.
              </span>
            )}
            {validation.questions != null && (
              <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                ❓ {validation.questions} вопрос в ответе
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section: Agent ───────────────────────────────────────────────────────────

// ─── AgentGuideModal ──────────────────────────────────────────────────────────

const AGENT_GUIDE_BLOCKS = [
  {
    title: "Роль",
    hint: "Кто ты?",
    example: "Ты — [должность] в [сфере].",
  },
  {
    title: "Поведение",
    hint: "Как действуешь?",
    example: "Задавай один вопрос за раз. Веди к цели.",
  },
  {
    title: "Ограничения",
    hint: "Чего НЕ делаешь?",
    example: "Не придумывай факты. Не уходи от темы.",
  },
];

const AGENT_GUIDE_ERRORS = [
  { bad: "\"ты AI-ассистент\"", why: "нет роли и цели" },
  { bad: "Длинные абзацы", why: "AI теряет контекст" },
  { bad: "Противоречивые правила", why: "непредсказуемое поведение" },
  { bad: "\"отвечай по базе знаний\"", why: "это задача Knowledge, не Agent" },
];

function AgentGuideModal({
  assistantId,
  onInsert,
  onClose,
}: {
  assistantId: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const autoGenerate = useAutoGenerateAgent();
  const [guideInput, setGuideInput] = useState("");
  const [generatedExample, setGeneratedExample] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    const input = guideInput.trim() || "универсальный ассистент";
    const result = await autoGenerate.mutateAsync({ input, assistantId });
    setGeneratedExample(result.rules);
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-sm">🤖</span>
            <h2 className="text-sm font-semibold text-neutral-900">Как настроить агента</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* Block 1 — What is an agent */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <span>01</span><span className="h-px flex-1 bg-neutral-100" />Что такое агент
            </h3>
            <div className="rounded-xl bg-neutral-50 p-3.5 text-sm text-neutral-700 leading-relaxed space-y-1.5">
              <p>Агент — это <strong>логика поведения</strong> ассистента в диалоге.</p>
              <p>Он не хранит знания — он управляет <strong>тоном, тактикой и этапами</strong> разговора.</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-green-100 bg-green-50 p-2.5">
                  <p className="text-xs font-semibold text-green-700 mb-1">Агент отвечает за:</p>
                  <ul className="space-y-0.5 text-xs text-green-800">
                    <li>✔ тон и стиль общения</li>
                    <li>✔ логику диалога</li>
                    <li>✔ цель разговора</li>
                  </ul>
                </div>
                <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
                  <p className="text-xs font-semibold text-red-700 mb-1">Knowledge отвечает за:</p>
                  <ul className="space-y-0.5 text-xs text-red-800">
                    <li>✔ факты и данные</li>
                    <li>✔ конкретные ответы</li>
                    <li>✔ базу знаний</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* Block 2 — Structure */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <span>02</span><span className="h-px flex-1 bg-neutral-100" />Структура правил
            </h3>
            <div className="space-y-2">
              {AGENT_GUIDE_BLOCKS.map((b) => (
                <div key={b.title} className="flex items-start gap-3 rounded-lg border border-neutral-100 bg-neutral-50 px-3.5 py-3">
                  <span className="mt-0.5 min-w-[64px] text-xs font-semibold text-neutral-700">{b.title}</span>
                  <div>
                    <p className="text-xs text-neutral-400 mb-0.5">{b.hint}</p>
                    <p className="font-mono text-xs text-neutral-700">{b.example}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Block 3 — Dynamic example */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <span>03</span><span className="h-px flex-1 bg-neutral-100" />Сгенерировать пример
            </h3>
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={guideInput}
                  onChange={(e) => setGuideInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleGenerate(); }}
                  placeholder="Опишите задачу агента (или оставьте пустым)"
                  className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                />
                <button
                  type="button"
                  disabled={autoGenerate.isPending}
                  onClick={() => void handleGenerate()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 transition-colors"
                >
                  {autoGenerate.isPending ? (
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
                    </svg>
                  ) : "⚡"}
                  {autoGenerate.isPending ? "Генерирую…" : "Создать"}
                </button>
              </div>
              {autoGenerate.isError && (
                <p className="text-xs text-red-500">
                  {autoGenerate.error instanceof Error ? autoGenerate.error.message : "Ошибка генерации"}
                </p>
              )}
              {generatedExample && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50">
                  <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-3.5 font-mono text-xs leading-relaxed text-neutral-800">
                    {generatedExample}
                  </pre>
                  <div className="flex items-center gap-2 border-t border-neutral-100 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleCopy(generatedExample)}
                      className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400 transition-colors"
                    >
                      {copied ? "✓ Скопировано" : "Скопировать"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { onInsert(generatedExample); onClose(); }}
                      className="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 transition-colors"
                    >
                      Вставить в правила →
                    </button>
                  </div>
                </div>
              )}
              {!generatedExample && !autoGenerate.isPending && (
                <p className="text-xs text-neutral-400">
                  Нажмите «Создать» — AI сгенерирует правила под вашу задачу
                </p>
              )}
            </div>
          </section>

          {/* Block 4 — Errors */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <span>04</span><span className="h-px flex-1 bg-neutral-100" />Частые ошибки
            </h3>
            <div className="space-y-1.5">
              {AGENT_GUIDE_ERRORS.map((e) => (
                <div key={e.bad} className="flex items-start gap-2.5 rounded-lg border border-red-50 bg-red-50 px-3 py-2">
                  <span className="mt-0.5 text-xs font-semibold text-red-500">✗</span>
                  <div>
                    <span className="text-xs font-medium text-red-700">{e.bad}</span>
                    <span className="ml-2 text-xs text-red-500">— {e.why}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const AGENT_TEMPLATES = [
  {
    label: "Продажи",
    icon: "💼",
    desc: "Ведёт к покупке, отрабатывает возражения",
    rules: `РОЛЬ: Продающий менеджер.
ЦЕЛЬ: Помочь клиенту сделать выбор и дойти до покупки.
ПРАВИЛА:
— Задавай один уточняющий вопрос за раз
— Предлагай конкретные решения под потребность клиента
— Отвечай кратко, без воды
— Завершай каждый ответ следующим шагом`,
  },
  {
    label: "Поддержка",
    icon: "🛟",
    desc: "Решает проблемы клиента шаг за шагом",
    rules: `РОЛЬ: Специалист технической поддержки.
ЦЕЛЬ: Решить проблему клиента максимально быстро.
ПРАВИЛА:
— Уточни детали проблемы перед ответом
— Давай пошаговые инструкции
— Будь терпелив и конкретен
— Если не можешь решить — сообщи об этом честно`,
  },
  {
    label: "FAQ",
    icon: "📖",
    desc: "Отвечает строго по базе знаний",
    rules: `РОЛЬ: Информационный ассистент.
ЦЕЛЬ: Давать точные ответы строго по базе знаний.
ПРАВИЛА:
— Отвечай только по известным данным
— Не придумывай факты
— Если информации нет — скажи об этом
— Не выходи за рамки своей области`,
  },
];

const AGENT_CAPABILITIES = [
  "Задаёт уточняющие вопросы",
  "Обрабатывает возражения",
  "Ведёт клиента к покупке",
  "Управляет этапами диалога",
];

function AgentSection({ assistant, agents }: { assistant: Assistant; agents: Agent[] }) {
  const linkedAgent = agents.find((a) => a.assistantId === assistant.id) ?? null;
  const patchAgent = usePatchAgent();
  const createAgent = useCreateAgent();

  const autoGenerate = useAutoGenerateAgent();

  const [rules, setRules] = useState(linkedAgent?.rules ?? "");
  const [agentRules, setAgentRules] = useState("");
  const [saved, setSaved] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [genInput, setGenInput] = useState("");
  const [genPreview, setGenPreview] = useState<string | null>(null);
  const [genInputError, setGenInputError] = useState("");

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

  async function handleAutoGenerate() {
    const trimmed = genInput.trim();
    if (!trimmed) {
      setGenInputError("Опишите задачу, чтобы сгенерировать правила");
      return;
    }
    setGenInputError("");
    const result = await autoGenerate.mutateAsync({ input: trimmed, assistantId: assistant.id });
    setGenPreview(result.rules);
  }

  async function handleCreate(template?: typeof AGENT_TEMPLATES[number], customRules?: string) {
    const r = customRules ?? (template ? template.rules : agentRules);
    const n = template ? `Агент · ${template.label}` : "Агент продаж";
    await createAgent.mutateAsync({
      name: n,
      type: "planner",
      mode: "v1",
      assistantId: assistant.id,
      rules: r || null,
    });
    setAgentRules("");
    setGenPreview(null);
    setGenInput("");
  }

  // ── Agent exists ────────────────────────────────────────────────────────────
  if (linkedAgent) {
    return (
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-base">
              🤖
            </span>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Агент продаж — {linkedAgent.name}
              </h3>
              <p className="text-xs text-neutral-400">управляет диалогом · логикой · продажей</p>
            </div>
          </div>
          <Link
            to={`/agents/${linkedAgent.id}`}
            className="text-xs text-neutral-500 underline hover:text-neutral-700"
          >
            Полный редактор →
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Capability chips */}
          <div className="flex flex-wrap gap-2">
            {AGENT_CAPABILITIES.map((cap) => (
              <span
                key={cap}
                className="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5.5L3.5 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {cap}
              </span>
            ))}
          </div>

          {/* Auto-generate panel */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <p className="text-xs font-semibold text-neutral-700">Сгенерировать правила с помощью AI</p>
            </div>
            <div className="space-y-1.5">
              <textarea
                rows={2}
                value={genInput}
                onChange={(e) => { setGenInput(e.target.value); setGenInputError(""); }}
                placeholder="Опишите задачу агента, например: «бот для продаж сайтов в студии»"
                className="w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              />
              {genInputError && <p className="text-xs text-red-500">{genInputError}</p>}
            </div>
            <button
              type="button"
              disabled={autoGenerate.isPending}
              onClick={() => void handleAutoGenerate()}
              className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 transition-colors"
            >
              {autoGenerate.isPending ? (
                <>
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
                  </svg>
                  Генерирую…
                </>
              ) : (
                <>⚡ Сгенерировать агента</>
              )}
            </button>
            {autoGenerate.isError && (
              <p className="text-xs text-red-500">
                {autoGenerate.error instanceof Error ? autoGenerate.error.message : "Ошибка генерации"}
              </p>
            )}

            {/* Preview */}
            {genPreview && (
              <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-3.5">
                <p className="text-xs font-semibold text-green-700">Результат генерации:</p>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-green-900">
                  {genPreview}
                </pre>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { setRules(genPreview); setGenPreview(null); setGenInput(""); }}
                    className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 transition-colors"
                  >
                    Использовать
                  </button>
                  <button
                    type="button"
                    disabled={autoGenerate.isPending}
                    onClick={() => void handleAutoGenerate()}
                    className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors"
                  >
                    Сгенерировать заново
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Rules editor */}
          {showGuide && (
            <AgentGuideModal
              assistantId={assistant.id}
              onInsert={(t) => setRules(t)}
              onClose={() => setShowGuide(false)}
            />
          )}
          <form onSubmit={(e) => void handleSaveRules(e)} className="space-y-3">
            <div>
              {/* Label row */}
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="agent-rules" className="text-xs font-medium text-neutral-600">
                  Правила поведения
                </label>
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-neutral-400">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
                  </svg>
                  Как настроить агента
                </button>
              </div>

              {/* Template chips */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-neutral-400">Шаблоны:</span>
                {AGENT_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    onClick={() => setRules(t.rules)}
                    className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-600 hover:bg-white hover:border-neutral-400 transition-colors"
                  >
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                id="agent-rules"
                rows={8}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder={`Например:\n— задавай уточняющие вопросы\n— веди к покупке\n— отвечай кратко`}
                className="w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              />

              {/* Tooltip */}
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-400">
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M7 6.5v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <circle cx="7" cy="4.5" r="0.75" fill="currentColor"/>
                </svg>
                Агент управляет поведением, а не знаниями — для фактов используйте базу знаний
              </p>
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

  // ── No agent ────────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-base">
            🤖
          </span>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Агент продаж (логика поведения)</h3>
            <p className="text-xs text-neutral-400">управляет диалогом · логикой · продажей</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* No-agent explanation */}
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-4">
          <p className="text-sm font-medium text-amber-900 mb-2">
            Ассистент сейчас просто отвечает на вопросы.
          </p>
          <p className="text-xs text-amber-700 mb-3">Подключите агента, чтобы AI:</p>
          <ul className="space-y-1.5">
            {AGENT_CAPABILITIES.map((cap) => (
              <li key={cap} className="flex items-center gap-2 text-xs text-amber-800">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <path d="M1.5 5.5L3.5 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                {cap}
              </li>
            ))}
          </ul>
        </div>

        {/* Auto-generate for new agent */}
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <p className="text-xs font-semibold text-neutral-700">Сгенерировать правила с помощью AI</p>
          </div>
          <div className="space-y-1.5">
            <textarea
              rows={2}
              value={genInput}
              onChange={(e) => { setGenInput(e.target.value); setGenInputError(""); }}
              placeholder="Опишите задачу агента, например: «бот для продаж сайтов в студии»"
              className="w-full resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
            />
            {genInputError && <p className="text-xs text-red-500">{genInputError}</p>}
          </div>
          <button
            type="button"
            disabled={autoGenerate.isPending}
            onClick={() => void handleAutoGenerate()}
            className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50 transition-colors"
          >
            {autoGenerate.isPending ? (
              <>
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12"/>
                </svg>
                Генерирую…
              </>
            ) : (
              <>⚡ Сгенерировать агента</>
            )}
          </button>
          {autoGenerate.isError && (
            <p className="text-xs text-red-500">
              {autoGenerate.error instanceof Error ? autoGenerate.error.message : "Ошибка генерации"}
            </p>
          )}

          {genPreview && (
            <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-3.5">
              <p className="text-xs font-semibold text-green-700">Результат генерации:</p>
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-green-900">
                {genPreview}
              </pre>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void handleCreate(undefined, genPreview)}
                  disabled={createAgent.isPending}
                  className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-600 disabled:opacity-50 transition-colors"
                >
                  Использовать
                </button>
                <button
                  type="button"
                  disabled={autoGenerate.isPending}
                  onClick={() => void handleAutoGenerate()}
                  className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 transition-colors"
                >
                  Сгенерировать заново
                </button>
              </div>
            </div>
          )}
        </div>

        {/* One-click template buttons */}
        <div>
          <p className="text-xs font-medium text-neutral-500 mb-2">Или выберите шаблон и подключите одним кликом:</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {AGENT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                disabled={createAgent.isPending}
                onClick={() => void handleCreate(t)}
                className="flex flex-col items-start gap-1 rounded-xl border-2 border-neutral-200 bg-white p-3.5 text-left hover:border-neutral-900 hover:bg-neutral-50 transition-all group"
              >
                <span className="text-xl">{t.icon}</span>
                <span className="text-sm font-semibold text-neutral-800 group-hover:text-neutral-900">
                  {t.label}
                </span>
                <span className="text-xs text-neutral-500">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main CTA */}
        <Button
          onClick={() => void handleCreate()}
          loading={createAgent.isPending}
          className="w-full"
        >
          Подключить агент продаж
        </Button>
        {createAgent.isError && (
          <p className="text-sm text-red-600">
            {createAgent.error instanceof Error ? createAgent.error.message : "Ошибка"}
          </p>
        )}

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

  // View / Edit
  const getKnowledge = useGetKnowledge();
  const patchKnowledge = usePatchKnowledge();
  const [viewItem, setViewItem] = useState<KnowledgeItemFull | null>(null);
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function handleView(id: string) {
    const full = await getKnowledge.mutateAsync(id);
    setViewItem(full);
  }

  function handleStartEdit(item: KnowledgeItem) {
    setEditItemId(item.id);
    setEditContent(item.contentPreview ?? "");
    // Load full content async
    void getKnowledge.mutateAsync(item.id).then((full) => {
      setEditContent(full.content ?? "");
    });
  }

  async function handleSaveEdit(id: string) {
    setEditSaving(true);
    try {
      await patchKnowledge.mutateAsync({ id, assistantId: assistant.id, content: editContent });
      setEditItemId(null);
    } finally {
      setEditSaving(false);
    }
  }

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
              <div key={item.id} className="rounded-lg border border-neutral-200 p-3">
                {editItemId === item.id ? (
                  /* ── Inline edit ── */
                  <div className="space-y-2">
                    <textarea
                      rows={6}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleSaveEdit(item.id)}
                        disabled={editSaving}
                        className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50 transition-colors"
                      >
                        {editSaving ? "Сохранение…" : "Сохранить"}
                      </button>
                      <button
                        onClick={() => setEditItemId(null)}
                        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── View row ── */
                  <div className="flex items-start gap-3">
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
                    <div className="flex items-center gap-1 shrink-0">
                      {/* View */}
                      <button
                        onClick={() => void handleView(item.id)}
                        disabled={getKnowledge.isPending}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
                        title="Просмотр"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <ellipse cx="7" cy="7" rx="6" ry="4" stroke="currentColor" strokeWidth="1.2"/>
                          <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                        </svg>
                      </button>
                      {/* Edit */}
                      <button
                        onClick={() => handleStartEdit(item)}
                        className="rounded p-1 text-neutral-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="Редактировать"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M9.5 2.5l2 2L4.5 11.5H2.5v-2L9.5 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => deleteKnowledge.mutate(item.id)}
                        disabled={deleteKnowledge.isPending}
                        className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="Удалить"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M2 4h10M5 4V2h4v2M5.5 6v5M8.5 6v5M3 4l.7 8h6.6L11 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* View modal */}
        {viewItem && (
          <KnowledgeViewModal
            item={viewItem}
            onClose={() => setViewItem(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── KnowledgeViewModal ───────────────────────────────────────────────────────

function KnowledgeViewModal({
  item,
  onClose,
}: {
  item: KnowledgeItemFull;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-neutral-800">
              {item.sourceName ?? `Запись ${item.id.slice(0, 8)}`}
            </p>
            {item.intent && (
              <span className="mt-0.5 inline-block text-xs text-neutral-500">
                Интент: {item.intent}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-800">
            {item.content}
          </pre>
        </div>
      </div>
    </div>
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
  intent?: string;
  modelUsed?: string;
  modelFallback?: boolean;
};

function ChatSection({ assistant }: { assistant: Assistant }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Last AI message for debug panel
  const lastAiMsg = [...messages].reverse().find((m) => m.role === "ai" && m.modelUsed);

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
              intent?: string;
              modelUsed?: string;
              modelFallback?: boolean;
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
            // "done" event carries knowledgeSource + fsmStage + modelUsed + intent
            if (payload.knowledgeSource != null || payload.modelUsed != null) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? {
                        ...m,
                        knowledgeSource: payload.knowledgeSource,
                        fsmStage: payload.fsmStage,
                        intent: payload.intent,
                        modelUsed: payload.modelUsed,
                        modelFallback: payload.modelFallback,
                      }
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

  const SOURCE_ICON: Record<string, string> = { fsm: "⚡", intent: "🎯", rag: "🔍", db: "📚" };
  const INTENT_BADGE: Record<string, { label: string; bg: string }> = {
    pricing:            { label: "Цена",         bg: "bg-blue-50 text-blue-700" },
    objection:          { label: "Возражение",   bg: "bg-orange-50 text-orange-700" },
    qualification_site: { label: "Квалификация", bg: "bg-purple-50 text-purple-700" },
    close:              { label: "Закрытие",      bg: "bg-green-50 text-green-700" },
    greeting:           { label: "Привет",        bg: "bg-neutral-100 text-neutral-600" },
    unknown:            { label: "—",             bg: "bg-neutral-100 text-neutral-500" },
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">Живой чат — тест</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              showDebug
                ? "border-violet-200 bg-violet-50 text-violet-700"
                : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
            )}
          >
            🔍 Debug
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              className="text-xs text-neutral-400 hover:text-neutral-600"
            >
              Очистить
            </button>
          )}
        </div>
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
                {/* Knowledge source badge */}
                {srcConf && (
                  <span className={cn("mt-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs", srcConf.bg)}>
                    <span>{srcConf.icon}</span>
                    📚 источник: {srcConf.label}
                    {m.knowledgeSource === "fsm" && m.fsmStage && (
                      <span className="ml-1 opacity-70">
                        ({INTENT_LABEL[m.fsmStage]?.label ?? m.fsmStage})
                      </span>
                    )}
                  </span>
                )}
                {/* Model badge */}
                {m.role === "ai" && m.modelUsed && (
                  <span className={cn(
                    "mt-0.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    m.modelFallback
                      ? "bg-amber-50 text-amber-700"
                      : "bg-neutral-100 text-neutral-500"
                  )}>
                    <span>🤖</span>
                    Модель: {m.modelUsed}
                    {m.modelFallback && <span className="ml-1 opacity-70">(fallback)</span>}
                  </span>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* ── Debug Panel ─────────────────────────────────────────────────────── */}
        {showDebug && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
            <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-violet-600">
              🔍 Debug — последний ответ
            </p>
            {lastAiMsg ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    key: "intent",
                    label: "Intent",
                    value: lastAiMsg.intent ?? "—",
                    badge: lastAiMsg.intent
                      ? (INTENT_BADGE[lastAiMsg.intent] ?? { label: lastAiMsg.intent, bg: "bg-neutral-100 text-neutral-600" })
                      : null,
                  },
                  {
                    key: "stage",
                    label: "Stage",
                    value: lastAiMsg.fsmStage ?? "—",
                    badge: lastAiMsg.fsmStage
                      ? { label: lastAiMsg.fsmStage, bg: "bg-indigo-50 text-indigo-700" }
                      : null,
                  },
                  {
                    key: "modelUsed",
                    label: "Model",
                    value: lastAiMsg.modelUsed ?? "—",
                    badge: lastAiMsg.modelFallback
                      ? { label: `${lastAiMsg.modelUsed} (fallback)`, bg: "bg-amber-50 text-amber-700" }
                      : { label: lastAiMsg.modelUsed ?? "—", bg: "bg-neutral-100 text-neutral-700" },
                  },
                  {
                    key: "knowledgeSource",
                    label: "Knowledge",
                    value: lastAiMsg.knowledgeSource ?? "—",
                    badge: lastAiMsg.knowledgeSource
                      ? { label: `${SOURCE_ICON[lastAiMsg.knowledgeSource] ?? ""} ${lastAiMsg.knowledgeSource}`, bg: "bg-green-50 text-green-700" }
                      : null,
                  },
                ].map(({ key, label, value, badge }) => (
                  <div key={key} className="rounded-lg bg-white border border-violet-100 px-3 py-2.5">
                    <p className="text-xs text-neutral-400 mb-1">{label}</p>
                    {badge ? (
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", badge.bg)}>
                        {badge.label}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-500">{value}</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-violet-400">
                Отправьте сообщение — данные появятся здесь
              </p>
            )}
            {/* Raw JSON */}
            {lastAiMsg && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-violet-500 hover:text-violet-700">
                  Raw JSON
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-md bg-white border border-violet-100 p-3 text-xs text-neutral-700">
                  {JSON.stringify({
                    intent: lastAiMsg.intent,
                    stage:  lastAiMsg.fsmStage,
                    modelUsed: lastAiMsg.modelUsed,
                    modelFallback: lastAiMsg.modelFallback,
                    knowledgeSource: lastAiMsg.knowledgeSource,
                  }, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

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
