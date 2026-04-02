import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Store, CheckCircle2, XCircle, Copy, RefreshCw, Loader2,
  MessageSquare, ClipboardList, ChevronDown, Zap, Users,
  Clock, ShieldCheck, Plus, Trash2, Pencil, Eye, EyeOff,
  ToggleLeft, ToggleRight, Link2, Send, KeyRound, RefreshCcw,
  Terminal, AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "../components/ui";
import { apiClient } from "../lib/apiClient";
import { useAuthStore } from "../stores/authStore";
import {
  useAvitoAccounts,
  useCreateAvitoAccount,
  usePatchAvitoAccount,
  useDeleteAvitoAccount,
  usePatchAvitoAgent,
  useAvitoConversations,
  useAvitoAudit,
  useAvitoSync,
  useAvitoTokenCheck,
  useAvitoDialogs,
  useAvitoTestSend,
  type AvitoAccount,
  type AvitoConversation,
  type AvitoAuditLog,
  type AvitoSyncResult,
  type AvitoTokenCheckResult,
  type AvitoDialogsResult,
  type AvitoTestSendResult,
} from "../api/avito";
import type { Agent } from "../api/types";

const WEBHOOK_BASE = "https://site-al.ru/api/incoming";

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVITO_MODES = [
  { value: "autoreply", label: "autoreply", desc: "ИИ отвечает сам",                color: "text-emerald-600 bg-emerald-50  border-emerald-200" },
  { value: "copilot",   label: "copilot",   desc: "ИИ готовит, человек отправляет", color: "text-blue-600   bg-blue-50    border-blue-200" },
  { value: "human",     label: "human",     desc: "Только запись, без ИИ",          color: "text-amber-600  bg-amber-50   border-amber-200" },
  { value: "off",       label: "off",       desc: "Игнорировать сообщения",         color: "text-neutral-500 bg-neutral-50 border-neutral-200" },
];

function modeStyle(v: string) {
  return AVITO_MODES.find((m) => m.value === v)?.color ?? AVITO_MODES[3].color;
}
function modeDesc(v: string) {
  return AVITO_MODES.find((m) => m.value === v)?.desc ?? "";
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function intentColor(intent: string) {
  const map: Record<string, string> = {
    price_inquiry: "text-violet-700 bg-violet-50", availability: "text-blue-700 bg-blue-50",
    delivery: "text-sky-700 bg-sky-50", complaint: "text-red-700 bg-red-50",
    greeting: "text-neutral-600 bg-neutral-100", payment: "text-emerald-700 bg-emerald-50",
    product_question: "text-amber-700 bg-amber-50", request_human: "text-orange-700 bg-orange-50",
    general: "text-neutral-500 bg-neutral-100",
  };
  return map[intent] ?? "text-neutral-500 bg-neutral-100";
}

// ── AccountForm ───────────────────────────────────────────────────────────────

interface AccountFormProps {
  initial?: Partial<AvitoAccount & { accessToken?: string }>;
  onSave:   (data: { name: string; accessToken: string; accountId: string; webhookSecret: string; isActive: boolean }) => void;
  onCancel: () => void;
  loading:  boolean;
}

function AccountForm({ initial, onSave, onCancel, loading }: AccountFormProps) {
  const [name,          setName]          = useState(initial?.name ?? "");
  const [accessToken,   setAccessToken]   = useState(initial?.accessToken ?? "");
  const [accountId,     setAccountId]     = useState(initial?.accountId ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [isActive,      setIsActive]      = useState(initial?.isActive ?? true);
  const [showToken,     setShowToken]     = useState(false);

  const isEdit = Boolean(initial?.id);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isEdit && !accessToken.trim()) return;
    if (!accountId.trim()) return;
    onSave({ name: name.trim(), accessToken: accessToken.trim(), accountId: accountId.trim(), webhookSecret: webhookSecret.trim(), isActive });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Название (необязательно)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Магазин запчастей"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-600">Account ID <span className="text-red-400">*</span></label>
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="123456789"
            required={!isEdit}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Access Token {isEdit ? "(оставьте пустым чтобы не менять)" : <span className="text-red-400">*</span>}
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={isEdit ? "••••••••• (не изменять)" : "Bearer token из Avito Developer Console"}
            required={!isEdit}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 pr-9 text-sm placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
          >
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">Webhook Secret (HMAC, необязательно)</label>
        <input
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder="Секрет для верификации подписи от Avito"
          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setIsActive(!isActive)}>
          {isActive
            ? <ToggleRight className="h-6 w-6 text-emerald-500" />
            : <ToggleLeft  className="h-6 w-6 text-neutral-400" />}
        </button>
        <span className="text-sm text-neutral-600">Аккаунт активен</span>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="rounded-md border border-neutral-200 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
          Отмена
        </button>
        <button type="submit" disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {isEdit ? "Сохранить" : "Подключить"}
        </button>
      </div>
    </form>
  );
}

// ── AccountCard ───────────────────────────────────────────────────────────────

function AccountCard({
  account,
  onEdit,
  onDelete,
  onToggle,
  deleting,
  toggling,
}: {
  account:  AvitoAccount;
  onEdit:   () => void;
  onDelete: () => void;
  onToggle: () => void;
  deleting: boolean;
  toggling: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={[
      "rounded-xl border p-4 transition-all",
      account.isActive ? "border-emerald-200 bg-emerald-50/40" : "border-neutral-200 bg-neutral-50",
    ].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={[
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
            account.isActive ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500",
          ].join(" ")}>
            {(account.name ?? account.accountId).slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-800">
              {account.name || `Аккаунт ${account.accountId}`}
            </p>
            <p className="text-xs text-neutral-500">ID: {account.accountId}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span className={[
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            account.isActive ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500",
          ].join(" ")}>
            {account.isActive ? "активен" : "выкл"}
          </span>
          <button onClick={onToggle} disabled={toggling}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-white hover:text-neutral-700 disabled:opacity-50"
            title={account.isActive ? "Деактивировать" : "Активировать"}>
            {toggling
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : account.isActive
                ? <ToggleRight className="h-4 w-4 text-emerald-500" />
                : <ToggleLeft  className="h-4 w-4" />}
          </button>
          <button onClick={onEdit}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-white hover:text-neutral-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={onDelete} disabled={deleting}
                className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-red-600 disabled:opacity-50">
                {deleting ? "…" : "Удалить"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-white">
                Отмена
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="rounded-md p-1.5 text-neutral-400 hover:bg-white hover:text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {account.hasToken && (
          <span className="flex items-center gap-1 rounded-md bg-white/80 border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Token OK
          </span>
        )}
        {account.hasWebhookSecret && (
          <span className="flex items-center gap-1 rounded-md bg-white/80 border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500">
            <ShieldCheck className="h-3 w-3 text-blue-500" /> Webhook Secret
          </span>
        )}
        <span className="text-[11px] text-neutral-400 ml-auto">{fmtDate(account.createdAt)}</span>
      </div>
    </div>
  );
}

// ── AgentRow ──────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  accounts,
  copiedId,
  onCopy,
}: {
  agent:    Agent;
  accounts: AvitoAccount[];
  copiedId: string | null;
  onCopy:   (id: string) => void;
}) {
  const patchAgent = usePatchAvitoAgent();
  const [modeOpen,    setModeOpen]    = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const mode            = agent.avitoMode ?? "autoreply";
  const linkedAccount   = accounts.find((a) => a.id === agent.avitoAccountId) ?? null;
  const webhookUrl      = `${WEBHOOK_BASE}/${agent.id}`;

  function setMode(m: string) {
    patchAgent.mutate({ agentId: agent.id, avitoMode: m });
    setModeOpen(false);
  }
  function setAccount(id: string | null) {
    patchAgent.mutate({ agentId: agent.id, avitoAccountId: id });
    setAccountOpen(false);
  }

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Avatar + name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-bold text-neutral-500">
            {agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-800">{agent.name}</p>
            <p className="text-[11px] text-neutral-400">{modeDesc(mode)}</p>
          </div>
        </div>

        {/* Account selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setAccountOpen(!accountOpen); setModeOpen(false); }}
            disabled={patchAgent.isPending}
            className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            <Link2 className="h-3 w-3 shrink-0 text-neutral-400" />
            <span className="max-w-[100px] truncate">
              {linkedAccount ? (linkedAccount.name || `ID ${linkedAccount.accountId}`) : "Аккаунт…"}
            </span>
            <ChevronDown className={["h-3 w-3 transition-transform", accountOpen ? "rotate-180" : ""].join(" ")} />
          </button>
          {accountOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
              <button
                onClick={() => setAccount(null)}
                className="w-full px-3 py-2 text-left text-xs text-neutral-400 hover:bg-neutral-50"
              >
                — не привязан —
              </button>
              {accounts.filter((a) => a.isActive).map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAccount(a.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                >
                  {a.id === agent.avitoAccountId && <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />}
                  <span className="truncate text-xs text-neutral-700">{a.name || `ID ${a.accountId}`}</span>
                </button>
              ))}
              {accounts.filter((a) => a.isActive).length === 0 && (
                <p className="px-3 py-2 text-[11px] text-neutral-400">Нет активных аккаунтов</p>
              )}
            </div>
          )}
        </div>

        {/* Mode selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setModeOpen(!modeOpen); setAccountOpen(false); }}
            disabled={patchAgent.isPending}
            className={["flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50", modeStyle(mode)].join(" ")}
          >
            {mode}
            <ChevronDown className={["h-3 w-3 transition-transform", modeOpen ? "rotate-180" : ""].join(" ")} />
          </button>
          {modeOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
              {AVITO_MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className="w-full px-3 py-2 text-left hover:bg-neutral-50"
                >
                  <span className={["inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium mr-2", m.color].join(" ")}>{m.value}</span>
                  <span className="text-xs text-neutral-500">{m.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Webhook URL */}
        <div className="flex items-center gap-1.5 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2.5 py-1.5">
          <code className="max-w-[140px] truncate text-[10px] text-neutral-500">{webhookUrl}</code>
          <button
            type="button"
            onClick={() => onCopy(agent.id)}
            className="ml-1 text-neutral-400 hover:text-neutral-700 transition-colors"
            title="Скопировать"
          >
            {copiedId === agent.id
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DiagRow / ErrorRow ────────────────────────────────────────────────────────

function DiagRow({ icon, label, data }: { icon: React.ReactNode; label: string; data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = JSON.stringify(data, null, 2);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left"
      >
        {icon}
        <span className="flex-1 text-xs font-medium text-neutral-700">{label}</span>
        <ChevronDown className={["h-3.5 w-3.5 text-neutral-400 transition-transform", expanded ? "rotate-180" : ""].join(" ")} />
      </button>
      {expanded && (
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-neutral-900 p-3 text-[10px] leading-relaxed text-emerald-400">
          {text}
        </pre>
      )}
    </div>
  );
}

function ErrorRow({ label, message }: { label: string; message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
      <div>
        <p className="text-xs font-medium text-red-700">{label}: ошибка</p>
        <p className="text-[11px] text-red-600 mt-0.5 break-all">{message}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AvitoPage() {
  const accessToken = useAuthStore((s) => s.accessToken);

  // Data
  const { data: accounts, isLoading: accountsLoading, refetch: refetchAccounts } = useAvitoAccounts();
  const { data: agents,   isLoading: agentsLoading } = useQuery({
    queryKey: ["agents"],
    queryFn:  () => apiClient.get<Agent[]>("/agents"),
    enabled:  Boolean(accessToken),
  });
  const { data: conversations, isLoading: convsLoading  } = useAvitoConversations();
  const { data: auditLogs,     isLoading: auditLoading  } = useAvitoAudit();

  // Mutations
  const createAccount = useCreateAvitoAccount();
  const patchAccount  = usePatchAvitoAccount();
  const deleteAccount = useDeleteAvitoAccount();

  // Diagnostic mutations
  const syncMutation       = useAvitoSync();
  const tokenCheckMutation = useAvitoTokenCheck();
  const dialogsMutation    = useAvitoDialogs();
  const testSendMutation   = useAvitoTestSend();

  // UI state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId,      setEditingId]      = useState<string | null>(null);
  const [copiedId,       setCopiedId]       = useState<string | null>(null);
  const [expandedAudit,  setExpandedAudit]  = useState<string | null>(null);
  const [testChatId,     setTestChatId]     = useState("");

  // Derived status
  const activeAccounts = accounts?.filter((a) => a.isActive && a.hasToken) ?? [];
  const connected      = activeAccounts.length > 0;

  function copyWebhook(agentId: string) {
    void navigator.clipboard.writeText(`${WEBHOOK_BASE}/${agentId}`);
    setCopiedId(agentId);
    setTimeout(() => setCopiedId(null), 1800);
  }

  async function handleCreate(data: { name: string; accessToken: string; accountId: string; webhookSecret: string; isActive: boolean }) {
    await createAccount.mutateAsync({
      name:          data.name || undefined,
      accessToken:   data.accessToken,
      accountId:     data.accountId,
      webhookSecret: data.webhookSecret || undefined,
      isActive:      data.isActive,
    });
    setShowCreateForm(false);
  }

  async function handleEdit(id: string, data: { name: string; accessToken: string; accountId: string; webhookSecret: string; isActive: boolean }) {
    await patchAccount.mutateAsync({
      id,
      name:          data.name || null,
      ...(data.accessToken ? { accessToken: data.accessToken } : {}),
      accountId:     data.accountId,
      webhookSecret: data.webhookSecret || null,
      isActive:      data.isActive,
    });
    setEditingId(null);
  }

  return (
    <div className="space-y-5 transition-all duration-200 ease-out">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-900">Avito Integration</h1>
            <p className="text-sm text-neutral-500">Мультиаккаунт · BullMQ · ИИ-ответы · CRM</p>
          </div>
        </div>
        <button
          onClick={() => void refetchAccounts()}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600 shadow-sm hover:bg-neutral-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Обновить
        </button>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className={["sm:col-span-1", connected ? "border-emerald-200" : "border-neutral-200"].join(" ")}>
          <CardContent className="flex items-center gap-3 py-4">
            {connected
              ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-500" />
              : <XCircle      className="h-7 w-7 shrink-0 text-neutral-300" />}
            <div>
              <p className="text-sm font-semibold text-neutral-800">
                {connected ? "Подключено" : "Не подключено"}
              </p>
              <p className="text-xs text-neutral-400">
                {connected ? `${activeAccounts.length} аккаунт(ов)` : "Добавьте аккаунт"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
              <Store className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-neutral-900">{accounts?.length ?? "—"}</p>
              <p className="text-xs text-neutral-400">Avito аккаунтов</p>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50">
              <MessageSquare className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-neutral-900">{conversations?.length ?? "—"}</p>
              <p className="text-xs text-neutral-400">Диалогов</p>
            </div>
          </CardContent>
        </Card>

        <Card className="sm:col-span-1">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
              <ClipboardList className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-neutral-900">{auditLogs?.length ?? "—"}</p>
              <p className="text-xs text-neutral-400">Записей аудита</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Diagnostic / Sync ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-800">Диагностика и синхронизация</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">

            {/* Sync chats */}
            <button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {syncMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCcw className="h-3.5 w-3.5" />}
              Синхронизировать чаты
            </button>

            {/* Get dialogs */}
            <button
              onClick={() => dialogsMutation.mutate()}
              disabled={dialogsMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              {dialogsMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <MessageSquare className="h-3.5 w-3.5" />}
              Получить диалоги
            </button>

            {/* Token check */}
            <button
              onClick={() => tokenCheckMutation.mutate()}
              disabled={tokenCheckMutation.isPending}
              className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {tokenCheckMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <KeyRound className="h-3.5 w-3.5" />}
              Проверить токен
            </button>
          </div>

          {/* Token check result */}
          {tokenCheckMutation.data && (
            <DiagRow
              icon={tokenCheckMutation.data.ok
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : <XCircle className="h-4 w-4 text-red-400" />}
              label="Токен"
              data={tokenCheckMutation.data as AvitoTokenCheckResult}
            />
          )}
          {tokenCheckMutation.error && (
            <ErrorRow label="Токен" message={(tokenCheckMutation.error as Error).message} />
          )}

          {/* Sync result */}
          {syncMutation.data && (
            <DiagRow
              icon={<RefreshCcw className="h-4 w-4 text-blue-500" />}
              label="Синхронизация"
              data={syncMutation.data as AvitoSyncResult}
            />
          )}
          {syncMutation.error && (
            <ErrorRow label="Синхронизация" message={(syncMutation.error as Error).message} />
          )}

          {/* Dialogs result */}
          {dialogsMutation.data && (
            <DiagRow
              icon={<MessageSquare className="h-4 w-4 text-violet-500" />}
              label="Диалоги"
              data={dialogsMutation.data as AvitoDialogsResult}
            />
          )}
          {dialogsMutation.error && (
            <ErrorRow label="Диалоги" message={(dialogsMutation.error as Error).message} />
          )}

          {/* Test send */}
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2">
            <p className="text-xs font-medium text-neutral-600">Тест отправки сообщения</p>
            <div className="flex gap-2">
              <input
                value={testChatId}
                onChange={(e) => setTestChatId(e.target.value)}
                placeholder="chatId (u2i_...)"
                className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs placeholder:text-neutral-400 focus:border-blue-400 focus:outline-none"
              />
              <button
                onClick={() => testSendMutation.mutate({ chatId: testChatId })}
                disabled={testSendMutation.isPending || !testChatId.trim()}
                className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {testSendMutation.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send className="h-3.5 w-3.5" />}
                Отправить
              </button>
            </div>
            {testSendMutation.data && (
              <DiagRow
                icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                label="Отправка"
                data={testSendMutation.data as AvitoTestSendResult}
              />
            )}
            {testSendMutation.error && (
              <ErrorRow label="Отправка" message={(testSendMutation.error as Error).message} />
            )}
          </div>

        </CardContent>
      </Card>

      {/* ── Avito Accounts ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Avito Аккаунты</h2>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                {accounts?.length ?? 0}
              </span>
            </div>
            {!showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Подключить аккаунт
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create form */}
          {showCreateForm && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <p className="mb-3 text-sm font-semibold text-blue-800">Новый Avito аккаунт</p>
              <AccountForm
                onSave={handleCreate}
                onCancel={() => setShowCreateForm(false)}
                loading={createAccount.isPending}
              />
            </div>
          )}

          {/* Account list */}
          {accountsLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
            </div>
          ) : !accounts?.length && !showCreateForm ? (
            <div className="rounded-xl border-2 border-dashed border-neutral-200 py-10 text-center">
              <Store className="mx-auto mb-2 h-8 w-8 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">Нет подключённых аккаунтов</p>
              <p className="mt-0.5 text-xs text-neutral-400">Нажмите "Подключить аккаунт" чтобы добавить Avito</p>
            </div>
          ) : (
            <div className="space-y-3">
              {accounts?.map((acc) => (
                editingId === acc.id ? (
                  <div key={acc.id} className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                    <p className="mb-3 text-sm font-semibold text-blue-800">Редактировать аккаунт</p>
                    <AccountForm
                      initial={acc}
                      onSave={(data) => void handleEdit(acc.id, data)}
                      onCancel={() => setEditingId(null)}
                      loading={patchAccount.isPending}
                    />
                  </div>
                ) : (
                  <AccountCard
                    key={acc.id}
                    account={acc}
                    onEdit={() => setEditingId(acc.id)}
                    onDelete={() => deleteAccount.mutate(acc.id)}
                    onToggle={() => patchAccount.mutate({ id: acc.id, isActive: !acc.isActive })}
                    deleting={deleteAccount.isPending}
                    toggling={patchAccount.isPending}
                  />
                )
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Agents ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Агенты</h2>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                {agents?.length ?? 0}
              </span>
            </div>
            <p className="text-xs text-neutral-400">Привяжите аккаунт и выберите режим для каждого агента</p>
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
                  accounts={accounts ?? []}
                  copiedId={copiedId}
                  onCopy={copyWebhook}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Conversations + Audit ─────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Последние диалоги</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {convsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
            ) : !conversations?.length ? (
              <p className="py-8 text-center text-sm text-neutral-400">Нет диалогов</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {(conversations as AvitoConversation[]).slice(0, 10).map((conv) => (
                  <li key={conv.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                      {String(conv.externalUserId ?? "?").slice(-2)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-neutral-700">{conv.chatId || "—"}</p>
                        <span className="shrink-0 text-[10px] text-neutral-400">{fmtDate(conv.updatedAt)}</span>
                      </div>
                      <p className="text-[11px] text-neutral-400">{conv.messageCount} сообщ. · user {conv.externalUserId}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-neutral-800">Журнал аудита</h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {auditLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-neutral-300" /></div>
            ) : !auditLogs?.length ? (
              <p className="py-8 text-center text-sm text-neutral-400">Нет записей</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {(auditLogs as AvitoAuditLog[]).slice(0, 10).map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedAudit(expandedAudit === log.id ? null : log.id)}
                      className="w-full px-5 py-3 text-left hover:bg-neutral-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {log.success
                            ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            : <XCircle      className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                          <span className={["shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", modeStyle(log.decision)].join(" ")}>
                            {log.decision}
                          </span>
                          {log.classification?.intent && (
                            <span className={["shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", intentColor(log.classification.intent)].join(" ")}>
                              {log.classification.intent}
                            </span>
                          )}
                          <span className="truncate text-xs text-neutral-500">{log.chatId}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {log.durationMs != null && (
                            <span className="flex items-center gap-0.5 text-[10px] text-neutral-400">
                              <Clock className="h-3 w-3" />{log.durationMs}ms
                            </span>
                          )}
                          <ChevronDown className={["h-3.5 w-3.5 text-neutral-400 transition-transform", expandedAudit === log.id ? "rotate-180" : ""].join(" ")} />
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
                        <div className="flex flex-wrap gap-3 text-[10px] text-neutral-500">
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

      {/* ── Pipeline docs ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-neutral-500" />
            <h2 className="text-sm font-semibold text-neutral-800">Архитектура pipeline</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Webhook",      desc: "Avito → POST → ACK 200 немедленно",            color: "bg-blue-50   text-blue-700",    border: "border-blue-100" },
              { step: "2", title: "BullMQ Queue", desc: "Идемпотентность → сохранение → enqueue",        color: "bg-violet-50 text-violet-700",  border: "border-violet-100" },
              { step: "3", title: "Classifier",   desc: "intent / priority / hotLead / requiresHuman",   color: "bg-amber-50  text-amber-700",   border: "border-amber-100" },
              { step: "4", title: "Router",        desc: "avitoMode + classifier → решение",              color: "bg-emerald-50 text-emerald-700",border: "border-emerald-100" },
              { step: "5", title: "AI (V2)",       desc: "agentChatV2 → DB-persisted context",            color: "bg-pink-50   text-pink-700",    border: "border-pink-100" },
              { step: "6", title: "CRM",           desc: "Первый контакт → Lead автоматически",          color: "bg-sky-50    text-sky-700",     border: "border-sky-100" },
              { step: "7", title: "Send + Retry",  desc: "DB account creds → sendMessage + 1 retry",     color: "bg-orange-50 text-orange-700",  border: "border-orange-100" },
              { step: "8", title: "Audit",         desc: "input/output/model/ms → AvitoAuditLog",        color: "bg-neutral-100 text-neutral-600", border: "border-neutral-200" },
            ].map(({ step, title, desc, color, border }) => (
              <div key={step} className={["rounded-lg border p-3", border].join(" ")}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={["inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", color].join(" ")}>{step}</span>
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
