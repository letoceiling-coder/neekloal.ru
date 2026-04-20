import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox as InboxIcon,
  Loader2,
  Pause,
  Search,
  Send,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  type InboxConversation,
  type InboxListFilters,
  useInboxConversations,
  useInboxMessages,
  useSendInboxMessage,
} from "../api/inbox";
import {
  useConversationTakeover,
  useConversationRelease,
} from "../api/avito";
import { Button, Card, ErrorState, Loader, Page } from "../components/ui";

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  avito:    { label: "Avito",    className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  telegram: { label: "Telegram", className: "bg-blue-50    text-blue-700    border-blue-200" },
  web:      { label: "Сайт",     className: "bg-violet-50  text-violet-700  border-violet-200" },
  api:      { label: "API",      className: "bg-neutral-50 text-neutral-700 border-neutral-200" },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function sourceBadge(source: string) {
  const meta = SOURCE_LABELS[source] ?? { label: source, className: "bg-neutral-50 text-neutral-700 border-neutral-200" };
  return (
    <span className={["inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium", meta.className].join(" ")}>
      {meta.label}
    </span>
  );
}

export function InboxPage() {
  const [source,   setSource]   = useState<InboxListFilters["source"]>("");
  const [takeover, setTakeover] = useState<InboxListFilters["takeover"]>("");
  const [q,        setQ]        = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const filters: InboxListFilters = useMemo(
    () => ({ source, takeover, q: qDebounced, limit: 100 }),
    [source, takeover, qDebounced]
  );

  const listQ = useInboxConversations(filters);

  const items = listQ.data?.items ?? [];
  const selected = useMemo(
    () => items.find((c) => c.id === selectedId) ?? null,
    [items, selectedId]
  );

  useEffect(() => {
    if (!selectedId && items.length > 0) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  return (
    <Page
      title="Входящие"
      description="Единый инбокс по всем каналам: Avito, сайт, Telegram. Ответ менеджера автоматически ставит AI на паузу."
    >
      <Card className="flex h-[calc(100vh-200px)] flex-col overflow-hidden">
        {/* ── Filters bar ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-4 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по chatId / title…"
              className="h-8 w-56 rounded-md border border-neutral-200 bg-white pl-7 pr-2 text-xs outline-none focus:border-violet-400"
            />
          </div>
          <select
            value={source ?? ""}
            onChange={(e) => setSource(e.target.value as InboxListFilters["source"])}
            className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-violet-400"
          >
            <option value="">Все источники</option>
            <option value="avito">Avito</option>
            <option value="telegram">Telegram</option>
            <option value="web">Сайт</option>
            <option value="api">API</option>
          </select>
          <select
            value={takeover ?? ""}
            onChange={(e) => setTakeover(e.target.value as InboxListFilters["takeover"])}
            className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs outline-none focus:border-violet-400"
          >
            <option value="">AI + менеджер</option>
            <option value="true">Только «В работе»</option>
            <option value="false">Только AI</option>
          </select>
          <span className="ml-auto text-[11px] text-neutral-400">
            {listQ.data?.total ?? 0} диалогов
          </span>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* ── Left list ─────────────────────────────────────────────── */}
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-r border-neutral-100">
            {listQ.isLoading ? (
              <Loader />
            ) : listQ.error ? (
              <ErrorState
                message={listQ.error instanceof Error ? listQ.error.message : "Ошибка"}
                onRetry={() => void listQ.refetch()}
              />
            ) : items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-6 text-xs text-neutral-400">
                <div className="text-center">
                  <InboxIcon className="mx-auto mb-2 h-6 w-6 text-neutral-300" />
                  Диалогов не найдено
                </div>
              </div>
            ) : (
              <ul className="flex-1 divide-y divide-neutral-100 overflow-y-auto">
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={[
                        "block w-full px-3 py-2.5 text-left transition-colors hover:bg-neutral-50",
                        selectedId === c.id ? "bg-violet-50/70" : "",
                      ].join(" ")}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        {sourceBadge(c.source)}
                        {c.humanTakeover && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                            <Pause className="h-2 w-2" />
                            В работе
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-neutral-400">
                          {fmtDate(c.updatedAt)}
                        </span>
                      </div>
                      <p className="truncate font-mono text-[11px] text-neutral-700" title={c.externalId ?? c.id}>
                        {c.externalId || c.title || c.id.slice(0, 8)}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral-500">
                        {c.lastMessage.role === "assistant" ? "→ " : "← "}
                        {c.lastMessage.snippet || "—"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* ── Right detail pane ──────────────────────────────────────── */}
          <section className="flex flex-1 flex-col overflow-hidden">
            {selected ? (
              <ConversationDetail conv={selected} />
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-neutral-400">
                Выберите диалог слева
              </div>
            )}
          </section>
        </div>
      </Card>
    </Page>
  );
}

// ─── Detail pane ─────────────────────────────────────────────────────────────

function ConversationDetail({ conv }: { conv: InboxConversation }) {
  const msgsQ = useInboxMessages(conv.id);
  const send  = useSendInboxMessage();
  const takeover = useConversationTakeover();
  const release  = useConversationRelease();

  const [text, setText] = useState("");
  const [err,  setErr]  = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setText("");
    setErr(null);
  }, [conv.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgsQ.data?.messages?.length]);

  const paused = Boolean(conv.humanTakeover);
  const canReply = conv.source === "avito";

  async function handleSend() {
    setErr(null);
    const t = text.trim();
    if (!t) return;
    if (!canReply) {
      setErr(`Отправка сообщений пока поддерживается только для Avito (source=${conv.source})`);
      return;
    }
    try {
      await send.mutateAsync({ conversationId: conv.id, text: t });
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось отправить");
    }
  }

  async function handleTakeover() {
    setErr(null);
    try {
      await takeover.mutateAsync({ conversationId: conv.id });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось взять диалог");
    }
  }

  async function handleRelease() {
    setErr(null);
    try {
      await release.mutateAsync(conv.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось вернуть диалог AI");
    }
  }

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {sourceBadge(conv.source)}
            {paused ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                <Pause className="h-2.5 w-2.5" />
                В работе{conv.humanTakeover?.by?.email ? ` · ${conv.humanTakeover.by.email}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                AI отвечает
              </span>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-neutral-700" title={conv.externalId ?? conv.id}>
            {conv.externalId ?? conv.id}
          </p>
          {conv.humanTakeover?.note && (
            <p className="truncate text-[11px] italic text-neutral-500" title={conv.humanTakeover.note}>
              «{conv.humanTakeover.note}»
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {paused ? (
            <button
              type="button"
              onClick={() => void handleRelease()}
              disabled={release.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              {release.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserX className="h-3 w-3" />}
              Передать AI
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleTakeover()}
              disabled={takeover.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              {takeover.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
              Взять в работу
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-neutral-50/60 px-4 py-3">
        {msgsQ.isLoading ? (
          <Loader />
        ) : msgsQ.error ? (
          <ErrorState
            message={msgsQ.error instanceof Error ? msgsQ.error.message : "Ошибка"}
            onRetry={() => void msgsQ.refetch()}
          />
        ) : (msgsQ.data?.messages ?? []).length === 0 ? (
          <p className="mt-6 text-center text-xs text-neutral-400">
            Сообщений ещё нет
          </p>
        ) : (
          <ul className="space-y-2">
            {msgsQ.data!.messages.map((m, idx) => {
              const isUser = m.role === "user";
              const isHuman = m.author === "human";
              return (
                <li
                  key={idx}
                  className={[
                    "flex",
                    isUser ? "justify-start" : "justify-end",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[80%] rounded-lg border px-3 py-2 text-sm shadow-sm",
                      isUser
                        ? "border-neutral-200 bg-white text-neutral-800"
                        : isHuman
                          ? "border-violet-200 bg-violet-50 text-violet-900"
                          : "border-emerald-200 bg-emerald-50 text-emerald-900",
                    ].join(" ")}
                  >
                    <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
                      {isUser ? "Клиент" : isHuman ? "Менеджер" : "AI"}
                      {m.sentAt ? ` · ${fmtDate(m.sentAt)}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-neutral-100 bg-white px-4 py-3">
        {err && (
          <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
            {err}
          </p>
        )}
        {!canReply && (
          <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            Ответ из админки пока работает только для Avito. Для канала «{conv.source}» используйте нативный клиент.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={2}
            placeholder={canReply ? "Сообщение клиенту (Ctrl+Enter — отправить)…" : "Отправка недоступна"}
            disabled={!canReply || send.isPending}
            className="flex-1 resize-none rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 disabled:opacity-60"
          />
          <Button
            type="button"
            onClick={() => void handleSend()}
            loading={send.isPending}
            disabled={!canReply || !text.trim()}
          >
            <Send className="mr-1 h-3.5 w-3.5" />
            Отправить
          </Button>
        </div>
        {canReply && !paused && (
          <p className="mt-1.5 text-[10px] text-neutral-400">
            После отправки диалог автоматически уйдёт «в работу» — AI перестанет отвечать.
          </p>
        )}
      </div>
    </>
  );
}
