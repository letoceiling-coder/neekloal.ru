/**
 * AgentChatPage — Pro Playground (V2)
 * Route: /agents/:agentId/chat
 *
 * Features:
 *  - DB-persisted multi-session conversations
 *  - Streaming responses (SSE) with fallback to non-streaming
 *  - System prompt override, temperature, max-tokens controls
 *  - Conversation list with "New chat" / delete
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft, Bot, MessageSquarePlus, RefreshCw, Send,
  Settings, Terminal, Trash2, User, Zap, ChevronRight,
} from "lucide-react";

import {
  useAgents,
  useModels,
  useCreateConversation,
  useConversations,
  useConversationDetail,
  useDeleteConversation,
  type ModelInfo,
} from "../api/agents";
import type { AgentConversationMeta, ConversationMessage } from "../api/agents";
import { useAgentConversationStore }  from "../stores/agentConversationStore";
import { useAuthStore }               from "../stores/authStore";
import { ApiError }                   from "../lib/apiClient";

// ── Helpers ───────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | null | undefined)[]) {
  return cls.filter(Boolean).join(" ");
}

function getApiBase() {
  const e = import.meta.env.VITE_API_URL;
  if (e && String(e).trim()) return String(e).replace(/\/$/, "");
  return `${window.location.origin}/api`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

const FALLBACK_MODELS = ["llama3:8b", "qwen2.5:7b"];

// ── Debug meta type ───────────────────────────────────────────────────────────

interface DebugMeta {
  modelUsed:     string;
  tokens:        { prompt: number; completion: number; total: number };
  contextLength: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({ role, content }: { role: string; content: string; streaming?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-3 px-1", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 mt-0.5">
          <Bot className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "rounded-tr-sm bg-violet-600 text-white"
            : "rounded-tl-sm bg-white text-gray-800 shadow-sm ring-1 ring-gray-100"
        )}
      >
        {content || <span className="opacity-40 italic">…</span>}
      </div>
      {isUser && (
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-white mt-0.5">
          <User className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}

function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-3 px-1 justify-start">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 mt-0.5">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[72%] rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm leading-relaxed text-gray-800 shadow-sm ring-1 ring-gray-100 whitespace-pre-wrap break-words">
        {content}
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-violet-500 align-text-bottom" />
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-3 px-1 justify-start">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white px-4 py-3.5 shadow-sm ring-1 ring-gray-100">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AgentChatPage() {
  const { agentId } = useParams<{ agentId: string }>();

  // ── Server data ───────────────────────────────────────────────────────────
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: modelsData }                        = useModels();
  const agent = agents?.find((a) => a.id === agentId) ?? null;

  // Extract model names from {name} objects, fallback to strings
  const availableModels: string[] =
    modelsData?.models?.length
      ? modelsData.models.map((m: ModelInfo) => m.name)
      : FALLBACK_MODELS;

  // ── Conversation list ─────────────────────────────────────────────────────
  const { data: convsData, refetch: refetchConvs } = useConversations(agentId);

  const createConvMutation  = useCreateConversation();
  const deleteConvMutation  = useDeleteConversation();

  // ── Zustand store ─────────────────────────────────────────────────────────
  const activeConversationId   = useAgentConversationStore((s) => s.activeConversationId);
  const setActiveConversation  = useAgentConversationStore((s) => s.setActiveConversation);
  const storeMessages          = useAgentConversationStore((s) => s.messages);
  const setStoreMessages       = useAgentConversationStore((s) => s.setMessages);
  const appendStoreMessage     = useAgentConversationStore((s) => s.appendMessage);
  const bumpCount              = useAgentConversationStore((s) => s.bumpMessageCount);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [input,          setInput]         = useState("");
  // model priority: agent.model → first available → fallback
  const [model,          setModel]         = useState<string>("");
  const [systemPrompt,   setSystemPrompt]  = useState("");
  const [temperature,    setTemperature]   = useState(0.7);
  const [maxTokens,      setMaxTokens]     = useState(800);
  const [streamingText,  setStreamingText] = useState("");
  const [isStreaming,    setIsStreaming]   = useState(false);
  const [isLoading,      setIsLoading]     = useState(false);
  const [error,          setError]         = useState<string | null>(null);
  const [debugMeta,      setDebugMeta]     = useState<DebugMeta | null>(null);
  const [showSettings,   setShowSettings]  = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  // Load conversation messages when active changes
  const { data: convDetail } = useConversationDetail(activeConversationId ?? null);

  useEffect(() => {
    if (convDetail?.messages) {
      setStoreMessages(convDetail.messages as ConversationMessage[]);
    }
  }, [convDetail?.id, convDetail?.messages?.length]);

  // Seed model: agent.model → first available → fallback (runs when agent or models data loads)
  useEffect(() => {
    if (model) return; // already set by user
    const preferred = agent?.model;
    if (preferred && (availableModels.includes(preferred) || availableModels.length === 0)) {
      setModel(preferred);
    } else if (availableModels.length > 0) {
      setModel(availableModels[0]);
    } else {
      setModel(FALLBACK_MODELS[0]);
    }
  }, [agent?.id, availableModels.join(",")]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Seed systemPrompt from agent.rules
  useEffect(() => {
    if (agent?.rules && !systemPrompt) {
      setSystemPrompt(agent.rules);
    }
  }, [agent?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [storeMessages.length, streamingText]);

  // ── Conversation management ───────────────────────────────────────────────

  const conversations: AgentConversationMeta[] = convsData?.conversations ?? [];

  async function handleNewConversation() {
    if (!agentId) return;
    const conv = await createConvMutation.mutateAsync({ agentId });
    await refetchConvs();
    setStoreMessages([]);
    setStreamingText("");
    setDebugMeta(null);
    setError(null);
    setActiveConversation(conv.id);
  }

  async function handleSelectConversation(id: string) {
    if (id === activeConversationId) return;
    setStoreMessages([]);
    setStreamingText("");
    setDebugMeta(null);
    setError(null);
    setActiveConversation(id);
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (id === activeConversationId) {
      setActiveConversation(null);
      setStoreMessages([]);
    }
    await deleteConvMutation.mutateAsync(id);
    await refetchConvs();
  }

  // ── Send message (streaming with fallback) ────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || !activeConversationId || isLoading || isStreaming) return;

    // Model selection priority log
    const modelSource =
      model && agent?.model && model !== agent.model ? "user"
      : model === agent?.model                        ? "agent"
      : "fallback";
    console.log(`[agent:model] selected=${model || FALLBACK_MODELS[0]} source=${modelSource}`);

    setError(null);
    setInput("");
    appendStoreMessage({ role: "user", content });
    setIsLoading(true);

    const token = useAuthStore.getState().accessToken;
    const ctrl  = new AbortController();
    abortRef.current = ctrl;

    // ── Try streaming first ───────────────────────────────────────────────
    let streamSucceeded = false;
    try {
      const res = await fetch(`${getApiBase()}/agents/chat/stream`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
          message:        content,
          model,
          systemPrompt:   systemPrompt.trim() || undefined,
          temperature,
          maxTokens,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      setIsLoading(false);
      setIsStreaming(true);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";
      let   accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines     = part.split("\n");
          let   eventName = "message";
          let   dataLine  = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
          }

          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine);

            if (eventName === "token" && parsed.token) {
              accumulated += parsed.token;
              setStreamingText(accumulated);
            } else if (eventName === "done" || parsed.done) {
              // Finalize: move streaming text into messages
              appendStoreMessage({ role: "assistant", content: accumulated });
              setStreamingText("");
              setDebugMeta({
                modelUsed:     parsed.modelUsed ?? model,
                tokens:        parsed.tokens ?? { prompt: 0, completion: 0, total: 0 },
                contextLength: parsed.contextLength ?? 0,
              });
              if (agentId && activeConversationId) {
                bumpCount(agentId, activeConversationId, 2);
              }
              streamSucceeded = true;
            } else if (eventName === "error") {
              throw new Error(parsed.error || "Stream error");
            }
          } catch (parseErr) {
            // Ignore JSON parse errors for individual SSE lines
          }
        }
      }
    } catch (streamErr) {
      if ((streamErr as { name?: string }).name === "AbortError") return;
      console.warn("[AgentChat] stream failed, falling back:", streamErr);
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }

    // ── Fallback: non-streaming V2 ────────────────────────────────────────
    if (!streamSucceeded) {
      try {
        setIsLoading(true);
        const { apiClient } = await import("../lib/apiClient");
        const result = await apiClient.post<{
          reply: string; modelUsed: string;
          tokens: { prompt: number; completion: number; total: number };
          contextLength: number;
        }>("/agents/chat/v2", {
          conversationId: activeConversationId,
          message:        content,
          model,
          systemPrompt:   systemPrompt.trim() || undefined,
          temperature,
          maxTokens,
        });

        appendStoreMessage({ role: "assistant", content: result.reply });
        setDebugMeta({
          modelUsed:     result.modelUsed,
          tokens:        result.tokens,
          contextLength: result.contextLength,
        });
        if (agentId && activeConversationId) {
          bumpCount(agentId, activeConversationId, 2);
        }
      } catch (fbErr) {
        const msg = fbErr instanceof ApiError ? fbErr.message : "Ошибка — попробуйте ещё раз";
        setError(msg);
      } finally {
        setIsLoading(false);
      }
    }
  }, [activeConversationId, isLoading, isStreaming, model, systemPrompt, temperature, maxTokens, agentId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingText("");
    setIsLoading(false);
  }

  const busy = isLoading || isStreaming;

  // ── Early returns ─────────────────────────────────────────────────────────

  if (agentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-500">Агент не найден</p>
        <Link to="/agents" className="text-sm text-violet-600 hover:underline">← К агентам</Link>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5 shadow-sm">
        <Link
          to={`/agents/${agentId}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100">
          <Bot className="h-3.5 w-3.5 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{agent.name}</p>
          <p className="text-[10px] text-gray-400">🧠 AI Runtime v2 · DB-persisted · streaming</p>
        </div>

        {/* Mobile settings toggle */}
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 lg:hidden"
        >
          <Settings className="h-4 w-4" />
        </button>

        <span className="hidden rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-700 sm:inline">
          Live
        </span>
      </div>

      {/* ── Body: 3 columns ──────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* LEFT: conversation list */}
        <aside className="hidden w-56 flex-shrink-0 flex-col border-r border-gray-200 bg-white lg:flex">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Чаты
            </p>
            <button
              type="button"
              onClick={() => void handleNewConversation()}
              disabled={createConvMutation.isPending}
              title="Новый чат"
              className="flex h-6 w-6 items-center justify-center rounded-md text-violet-600 hover:bg-violet-50 transition disabled:opacity-40"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {conversations.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-[11px] text-gray-400">Нет чатов</p>
                <button
                  type="button"
                  onClick={() => void handleNewConversation()}
                  className="mt-2 text-[11px] text-violet-600 hover:underline"
                >
                  + Создать
                </button>
              </div>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => void handleSelectConversation(conv.id)}
                  className={cn(
                    "group w-full rounded-lg mx-1 px-2.5 py-2 text-left transition",
                    conv.id === activeConversationId
                      ? "bg-violet-50 text-violet-700"
                      : "text-gray-700 hover:bg-gray-50"
                  )}
                  style={{ width: "calc(100% - 8px)" }}
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {conv.title ?? `Чат ${fmtDate(conv.createdAt)}`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        {conv.messageCount} сообщ. · {fmtDate(conv.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => void handleDeleteConversation(conv.id, e)}
                      className="flex-shrink-0 rounded p-0.5 text-gray-300 opacity-0 hover:text-red-500 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* CENTER: chat */}
        <main className="flex min-w-0 flex-1 flex-col">

          {/* No conversation selected */}
          {!activeConversationId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100">
                <Bot className="h-7 w-7 text-violet-400" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-700">Выберите или создайте чат</p>
                <p className="mt-1 text-xs text-gray-400">
                  Агент: <span className="font-medium text-gray-600">{agent.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleNewConversation()}
                disabled={createConvMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700 transition disabled:opacity-50"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Новый чат
              </button>
              {/* Mobile: conversation list inline */}
              {conversations.length > 0 && (
                <div className="mt-2 w-full max-w-xs lg:hidden">
                  <p className="mb-2 text-xs font-medium text-gray-500">Существующие чаты:</p>
                  {conversations.slice(0, 5).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void handleSelectConversation(c.id)}
                      className="mb-1 flex w-full items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-700 hover:border-violet-200 hover:bg-violet-50 transition"
                    >
                      <ChevronRight className="h-3 w-3 text-gray-400" />
                      {c.title ?? `Чат ${fmtDate(c.createdAt)}`}
                      <span className="ml-auto text-gray-400">{c.messageCount} msg</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Messages scroll area */}
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
                {storeMessages.length === 0 && !isLoading && !isStreaming ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                    <Bot className="h-10 w-10 text-violet-200" />
                    <p className="text-sm text-gray-500">Напишите первое сообщение</p>
                    <p className="text-[11px] text-gray-400">Enter → отправить · Shift+Enter → перенос</p>
                  </div>
                ) : (
                  storeMessages.map((msg, i) => (
                    <MessageBubble key={i} role={msg.role} content={msg.content} />
                  ))
                )}
                {isLoading && !isStreaming && <TypingDots />}
                {isStreaming && streamingText && <StreamingBubble content={streamingText} />}
                {isStreaming && !streamingText && <TypingDots />}
                <div ref={bottomRef} />
              </div>

              {/* Error banner */}
              {error && (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                  <span>❌ {error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="ml-auto text-red-400 hover:text-red-600"
                  >×</button>
                </div>
              )}

              {/* Debug panel */}
              {debugMeta && (
                <div className="flex-shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono text-gray-400">
                    <span className="flex items-center gap-1">
                      <Terminal className="h-2.5 w-2.5" />
                      <span className="text-gray-600">{debugMeta.modelUsed}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Zap className="h-2.5 w-2.5" />
                      tokens: <span className="text-gray-600">{debugMeta.tokens.total}</span>
                      <span className="text-gray-300">
                        ({debugMeta.tokens.prompt}↑ {debugMeta.tokens.completion}↓)
                      </span>
                    </span>
                    <span>
                      context: <span className="text-gray-600">{debugMeta.contextLength}</span> msgs
                    </span>
                  </div>
                </div>
              )}

              {/* Input area */}
              <div className="flex-shrink-0 border-t border-gray-200 bg-white p-3">
                <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={busy}
                    rows={1}
                    placeholder="Сообщение… (Enter → отправить, Shift+Enter → перенос)"
                    className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-50 max-h-32 overflow-y-auto"
                    style={{ minHeight: "1.5rem" }}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                    }}
                  />
                  {busy ? (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-500 transition"
                      title="Отменить"
                    >
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void sendMessage(input)}
                      disabled={!input.trim()}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </main>

        {/* RIGHT: settings panel */}
        <aside
          className={cn(
            "flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto",
            // Desktop: always visible
            "hidden lg:flex lg:w-64 lg:flex-col",
          )}
        >
          <div className="border-b border-gray-100 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Настройки</p>
          </div>

          <div className="flex flex-col gap-5 px-4 py-4">
            {/* New chat button */}
            <button
              type="button"
              onClick={() => void handleNewConversation()}
              disabled={createConvMutation.isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-600 py-2 text-xs font-medium text-white hover:bg-violet-700 transition disabled:opacity-50"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Новый чат
            </button>

            {/* Model */}
            <div>
              <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <span>🤖 Модель</span>
                {agent?.model && (
                  <span className="normal-case text-[9px] text-violet-400">
                    агент: {agent.model}
                  </span>
                )}
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 outline-none focus:border-violet-400 disabled:opacity-50"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <p className="mt-1 text-[9px] text-gray-400">
                {agent?.model && model === agent.model
                  ? "✓ Модель агента"
                  : agent?.model && model !== agent.model
                    ? "↑ Переопределено вами"
                    : "Выбрано вручную"}
              </p>
            </div>

            {/* System prompt */}
            <div>
              <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <span>🧠 System Prompt</span>
                {agent.rules && (
                  <button
                    type="button"
                    onClick={() => setSystemPrompt(agent.rules ?? "")}
                    className="normal-case text-[9px] text-violet-500 hover:underline"
                  >
                    сброс
                  </button>
                )}
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={5}
                placeholder="Системный промпт агента…"
                className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] leading-relaxed text-gray-700 outline-none focus:border-violet-400 focus:bg-white transition"
              />
            </div>

            {/* Temperature */}
            <div>
              <label className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                <span>🌡 Temperature</span>
                <span className="font-mono text-gray-600">{temperature.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-violet-600"
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-gray-300">
                <span>точный</span>
                <span>творческий</span>
              </div>
            </div>

            {/* Max tokens */}
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                📏 Max Tokens
              </label>
              <input
                type="number"
                min={50}
                max={4000}
                step={50}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-700 outline-none focus:border-violet-400"
              />
            </div>

            {/* Agent info */}
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Агент</p>
              <p className="text-xs font-medium text-gray-700">{agent.name}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{agent.type}</p>
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600">
                🧠 AI Runtime v2
              </span>
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile settings drawer overlay */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSettings(false)} />
          <div className="relative ml-auto flex h-full w-72 flex-col overflow-y-auto bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-gray-800">Настройки</p>
              <button type="button" onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="flex flex-col gap-5 px-4 py-4">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">Модель</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-700 outline-none"
                >
                  {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">🧠 System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] text-gray-700 outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  <span>🌡 Temperature</span>
                  <span className="font-mono">{temperature.toFixed(1)}</span>
                </label>
                <input
                  type="range" min={0} max={1} step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-violet-600"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">📏 Max Tokens</label>
                <input
                  type="number" min={50} max={4000} step={50}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-xs outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
