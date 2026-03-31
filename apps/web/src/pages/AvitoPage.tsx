import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Store,
  CheckCircle2,
  XCircle,
  Copy,
  RefreshCw,
  Loader2,
  MessageSquare,
  ClipboardList,
  ChevronDown,
  Zap,
  Users,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
} from "../components/ui";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";
import type { Agent } from "../api/types";

const WEBHOOK_BASE = "https://site-al.ru/api/avito/webhook";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AvitoConversation {
  id:             string;
  agentId:        string;
  chatId:         string;
  externalUserId: string;
  title:          string | null;
  messageCount:   number;
  createdAt:      string;
  updatedAt:      string;
}

interface AvitoAuditLog {
  id:         string;
  agentId:    string;
  chatId:     string;
  authorId:   string;
  input:      string;
  output:     string | null;
  decision:   string;
  modelUsed:  string | null;
  success:    boolean;
  durationMs: number | null;
  createdAt:  string;
  classification?: {
    intent:        string;
    priority:      string;
    isHotLead:     boolean;
    requiresHuman: boolean;
    confidence:    number;
  } | null;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const AVITO_MODES = [
  { value: "autoreply", label: "autoreply",  desc: "ИИ отвечает сам",                color: "text-emerald-600 bg-emerald-50  border-emerald-200" },
  { value: "copilot",   label: "copilot",    desc: "ИИ готовит, человек отправляет", color: "text-blue-600   bg-blue-50    border-blue-200" },
  { value: "human",     label: "human",      desc: "Только запись, без ИИ",          color: "text-amber-600  bg-amber-50   border-amber-200" },
  { value: "off",       label: "off",        desc: "Игнорировать сообщения",         color: "text-neutral-500 bg-neutral-50 border-neutral-200" },
];

function modeStyle(value: string) {
  return AVITO_MODES.find((m) => m.value === value)?.color ?? AVITO_MODES[3].color;
}
function modeDesc(value: string) {
  return AVITO_MODES.find((m) => m.value === value)?.desc ?? "";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function intentBadge(intent: string) {
  const map: Record<string, string> = {
    price_inquiry:  "text-violet-700 bg-violet-50",
    availability:   "text-blue-700   bg-blue-50",
    delivery:       "text-sky-700    bg-sky-50",
    complaint:      "text-red-700    bg-red-50",
    greeting:       "text-neutral-600 bg-neutral-100",
    payment:        "text-emerald-700 bg-emerald-50",
    product_question: "text-amber-700 bg-amber-50",
    request_human:  "text-orange-700 bg-orange-50",
    general:        "text-neutral-500 bg-neutral-100",
  };
  return map[intent] ?? "text-neutral-500 bg-neutral-100";
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useAgents() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => apiClient.get<Agent[]>("/agents"),
    enabled: Boolean(accessToken),
  });
}

function useAvitoStatus() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["avito-status"],
    queryFn: async () => {
      try {
        await apiClient.get("/avito/chats");
        return "connected" as const;
      } catch {
        return "disconnected" as const;
      }
    },
    enabled: Boolean(accessToken),
    staleTime: 30_000,
    retry: false,
  });
}

function useAvitoConversations() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["avito-conversations"],
    queryFn: () => apiClient.get<AvitoConversation[]>("/avito/conversations"),
    enabled: Boolean(accessToken),
    staleTime: 15_000,
  });
}

function useAvitoAudit() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ["avito-audit"],
    queryFn: () => apiClient.get<AvitoAuditLog[]>("/avito/audit"),
    enabled: Boolean(accessToken),
    staleTime: 15_000,
  });
}

function usePatchAvitoMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, avitoMode }: { agentId: string; avitoMode: string }) =>
      apiClient.patch<{ id: string; avitoMode: string }>(`/avito/agent/${agentId}`, { avitoMode }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AvitoPage() {
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useAvitoStatus();
  const { data: conversations, isLoading: convsLoading } = useAvitoConversations();
  const { data: auditLogs,     isLoading: auditLoading  } = useAvitoAudit();
  const patchMode = usePatchAvitoMode();

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);

  function copyWebhook(agentId: string) {
    void navigator.clipboard.writeText(`${WEBHOOK_BASE}/${agentId}`);
    setCopiedId(agentId);
    setTimeout(() => setCopiedId(null), 1800);
  }

  const connected = status === "connected";

  return (
    <div className="space-y-5 transition-all duration-200 ease-out">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">Avito Integration</h1>
            <p className="text-sm text-neutral-500">Управление Avito Messenger — очереди, ИИ-ответы, CRM</p>
          </div>
        </div>
        <button
          onClick={() => void refetchStatus()}
          disabled={statusLoading}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 shadow-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          <RefreshCw className={["h-3.5 w-3.5", statusLoading ? "animate-spin" : ""].join(" ")} />
          Обновить статус
        </button>
      </div>

      {/* ── Status + Setup ───────────────────────────────────────────────────── */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {/* Connection status */}
        <Card className={["sm:col-span-1", connected ? "border-emerald-200" : "border-red-200"].join(" ")}>
          <CardContent className="flex items-center gap-3 py-4">
            {statusLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
            ) : connected ? (
              <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="h-8 w-8 shrink-0 text-red-400" />
            )}
            <div>
              <p className="text-sm font-semibold text-neutral-800">
                {statusLoading ? "Проверка…" : connected ? "Подключено" : "Не подключено"}
              </p>
              <p className="text-xs text-neutral-400">
                {connected ? "Avito API доступен" : "AVITO_TOKEN не настроен"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <Card className="sm:col-span-1">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <MessageSquare className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-neutral-900">{conversations?.length ?? "—"}</p>
              <p className="text-xs text-neutral-400">Avito диалогов</p>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
              <ClipboardList className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-neutral-900">{auditLogs?.length ?? "—"}</p>
              <p className="text-xs text-neutral-400">Записей аудита</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Env Setup Hint ───────────────────────────────────────────────────── */}
      {!connected && !statusLoading && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-1">Настройте переменные среды</p>
                <p className="text-xs text-amber-700 mb-2">Добавьте в <code className="rounded bg-amber-100 px-1 py-0.5">/var/www/site-al.ru/apps/api/.env</code>:</p>
                <pre className="rounded-md bg-amber-100 px-3 py-2 text-xs font-mono text-amber-900 overflow-x-auto">{`AVITO_TOKEN=ваш_oauth_токен
AVITO_ACCOUNT_ID=числовой_id_аккаунта
AVITO_WEBHOOK_SECRET=опциональный_секрет`}</pre>
                <p className="mt-2 text-xs text-amber-600">После изменения .env выполните: <code className="rounded bg-amber-100 px-1 py-0.5">pm2 restart ai-api</code></p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Agents ───────────────────────────────────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Агенты</h2>
            </div>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
              {agents?.length ?? 0}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {agentsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
            </div>
          ) : !agents?.length ? (
            <p className="py-8 text-center text-sm text-neutral-400">Нет агентов</p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  copiedId={copiedId}
                  onCopy={copyWebhook}
                  onModeChange={(mode) =>
                    patchMode.mutate({ agentId: agent.id, avitoMode: mode })
                  }
                  saving={patchMode.isPending}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Conversations + Audit side-by-side ───────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Conversations */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Последние диалоги</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {convsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
              </div>
            ) : !conversations?.length ? (
              <p className="py-8 text-center text-sm text-neutral-400">Нет диалогов</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {conversations.slice(0, 10).map((conv) => (
                  <li key={conv.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                      {String(conv.externalUserId).slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-neutral-700">
                          {conv.chatId || "—"}
                        </p>
                        <span className="shrink-0 text-[10px] text-neutral-400">
                          {fmtDate(conv.updatedAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400">
                        {conv.messageCount} сообщений · user {conv.externalUserId}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Audit log */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Журнал аудита</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {auditLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
              </div>
            ) : !auditLogs?.length ? (
              <p className="py-8 text-center text-sm text-neutral-400">Нет записей</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {auditLogs.slice(0, 10).map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedAudit(expandedAudit === log.id ? null : log.id)}
                      className="w-full px-5 py-3 text-left hover:bg-neutral-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {log.success ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                          )}
                          <span
                            className={[
                              "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                              modeStyle(log.decision),
                            ].join(" ")}
                          >
                            {log.decision}
                          </span>
                          {log.classification?.intent && (
                            <span
                              className={[
                                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                intentBadge(log.classification.intent),
                              ].join(" ")}
                            >
                              {log.classification.intent}
                            </span>
                          )}
                          <span className="truncate text-xs text-neutral-500">
                            {log.chatId}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {log.durationMs && (
                            <span className="flex items-center gap-0.5 text-[10px] text-neutral-400">
                              <Clock className="h-3 w-3" />
                              {log.durationMs}ms
                            </span>
                          )}
                          <ChevronDown
                            className={[
                              "h-3.5 w-3.5 text-neutral-400 transition-transform",
                              expandedAudit === log.id ? "rotate-180" : "",
                            ].join(" ")}
                          />
                        </div>
                      </div>
                      <p className="mt-1 truncate text-left text-[11px] text-neutral-400">
                        {log.input.slice(0, 80)}{log.input.length > 80 ? "…" : ""}
                      </p>
                    </button>

                    {expandedAudit === log.id && (
                      <div className="border-t border-neutral-100 bg-neutral-50 px-5 py-3 space-y-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">Вопрос</p>
                          <p className="text-xs text-neutral-700">{log.input}</p>
                        </div>
                        {log.output && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">Ответ ИИ</p>
                            <p className="text-xs text-neutral-600 leading-relaxed">{log.output.slice(0, 300)}{log.output.length > 300 ? "…" : ""}</p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 text-[10px] text-neutral-500">
                          {log.modelUsed && <span>model: <strong>{log.modelUsed}</strong></span>}
                          {log.classification && (
                            <>
                              <span>priority: <strong>{log.classification.priority}</strong></span>
                              <span>hotLead: <strong>{log.classification.isHotLead ? "да" : "нет"}</strong></span>
                              <span>conf: <strong>{log.classification.confidence}</strong></span>
                            </>
                          )}
                          <span>{fmtDate(log.createdAt)}</span>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Pipeline Docs ────────────────────────────────────────────────────── */}
      <Card className="mt-5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-800">Архитектура pipeline</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Webhook",      desc: "Avito → POST → ACK 200 немедленно",              color: "bg-blue-50   text-blue-700",   border: "border-blue-100" },
              { step: "2", title: "BullMQ Queue", desc: "Идемпотентность → сохранение → enqueue",          color: "bg-violet-50 text-violet-700", border: "border-violet-100" },
              { step: "3", title: "Classifier",   desc: "intent / priority / hotLead / requiresHuman",     color: "bg-amber-50  text-amber-700",  border: "border-amber-100" },
              { step: "4", title: "Router",       desc: "avitoMode + classifier → autoreply/copilot/human", color: "bg-emerald-50 text-emerald-700", border: "border-emerald-100" },
              { step: "5", title: "AI (V2)",      desc: "agentChatV2 → DB-persisted context",              color: "bg-pink-50   text-pink-700",   border: "border-pink-100" },
              { step: "6", title: "CRM",          desc: "Первый контакт → Lead создаётся автоматически",   color: "bg-sky-50    text-sky-700",    border: "border-sky-100" },
              { step: "7", title: "Send + Retry", desc: "avitoClient.sendMessage + 1 retry on fail",       color: "bg-orange-50 text-orange-700", border: "border-orange-100" },
              { step: "8", title: "Audit",        desc: "input/output/model/ms → AvitoAuditLog",           color: "bg-neutral-100 text-neutral-600", border: "border-neutral-200" },
            ].map(({ step, title, desc, color, border }) => (
              <div key={step} className={["rounded-lg border p-3", border].join(" ")}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={["inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", color].join(" ")}>
                    {step}
                  </span>
                  <p className="text-xs font-semibold text-neutral-700">{title}</p>
                </div>
                <p className="text-[11px] leading-relaxed text-neutral-500">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── AgentRow sub-component ────────────────────────────────────────────────────

function AgentRow({
  agent,
  copiedId,
  onCopy,
  onModeChange,
  saving,
}: {
  agent: Agent;
  copiedId: string | null;
  onCopy: (id: string) => void;
  onModeChange: (mode: string) => void;
  saving: boolean;
}) {
  const webhookUrl = `${WEBHOOK_BASE}/${agent.id}`;
  const mode = agent.avitoMode ?? "autoreply";
  const [open, setOpen] = useState(false);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: name + mode */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-sm font-bold text-neutral-500">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-800">{agent.name}</p>
            <p className="text-[11px] text-neutral-400">{modeDesc(mode)}</p>
          </div>
        </div>

        {/* Right: mode selector + webhook */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              disabled={saving}
              className={[
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                modeStyle(mode),
              ].join(" ")}
            >
              {mode}
              <ChevronDown className={["h-3 w-3 transition-transform", open ? "rotate-180" : ""].join(" ")} />
            </button>
            {open && (
              <div className="absolute right-0 top-full z-10 mt-1 w-52 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                {AVITO_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => { onModeChange(m.value); setOpen(false); }}
                    className="w-full px-3 py-2 text-left hover:bg-neutral-50"
                  >
                    <span className={["inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium mr-2", m.color].join(" ")}>
                      {m.value}
                    </span>
                    <span className="text-xs text-neutral-500">{m.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Webhook URL */}
          <div className="flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2.5 py-1.5">
            <code className="max-w-[160px] truncate text-[10px] text-neutral-500">{webhookUrl}</code>
            <button
              type="button"
              onClick={() => onCopy(agent.id)}
              className="ml-1 rounded p-0.5 text-neutral-400 hover:text-neutral-700 transition-colors"
              title="Скопировать"
            >
              {copiedId === agent.id ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
