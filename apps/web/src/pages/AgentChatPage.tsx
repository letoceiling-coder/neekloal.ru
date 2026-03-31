/**
 * AgentChatPage — Playground for testing agent behavior with real LLM.
 * Route: /agents/:agentId/chat
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Send, Bot, User, Terminal, Zap } from "lucide-react";
import { useAgents, useAgentChatMutation, useModels } from "../api/agents";
import { useAgentChatStore } from "../stores/agentChatStore";
import { ApiError } from "../lib/apiClient";
import type { AgentChatResponse } from "../api/agents";

// ── Helpers ──────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

// Fallback models if /models endpoint is unavailable
const FALLBACK_MODELS = ["qwen2.5:7b", "llama3:8b"];

// ── Sub-components ────────────────────────────────────────────────────────────

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-violet-600 text-white"
            : "rounded-tl-sm bg-white text-gray-800 shadow-sm ring-1 ring-gray-100"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
      </div>
      {isUser && (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 text-white">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm ring-1 ring-gray-100">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function DebugPanel({
  meta,
}: {
  meta: Omit<AgentChatResponse, "reply"> | null;
}) {
  if (!meta) return null;
  return (
    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-gray-500">
        <span className="flex items-center gap-1">
          <Terminal className="h-3 w-3" />
          MODEL: <span className="font-semibold text-gray-700">{meta.modelUsed}</span>
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          TOKENS: <span className="font-semibold text-gray-700">{meta.tokens.total}</span>
          <span className="text-gray-400">({meta.tokens.prompt}↑ {meta.tokens.completion}↓)</span>
        </span>
        <span>
          CONTEXT: <span className="font-semibold text-gray-700">{meta.contextLength}</span> msgs
        </span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AgentChatPage() {
  const { agentId } = useParams<{ agentId: string }>();

  // Data
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: modelsData } = useModels();
  const agent = agents?.find((a) => a.id === agentId) ?? null;

  const availableModels =
    modelsData?.models && modelsData.models.length > 0
      ? modelsData.models
      : FALLBACK_MODELS;

  // Zustand chat state
  const messages     = useAgentChatStore((s) => s.getMessages(agentId ?? ""));
  const addMessage   = useAgentChatStore((s) => s.addMessage);
  const clearMessages = useAgentChatStore((s) => s.clearMessages);

  // Local UI state
  const [input,    setInput]    = useState("");
  const [model,    setModel]    = useState(FALLBACK_MODELS[0]);
  const [lastMeta, setLastMeta] = useState<Omit<AgentChatResponse, "reply"> | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const chatMutation = useAgentChatMutation();
  const isLoading    = chatMutation.isPending || resetting;

  const bottomRef      = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Sync model to first available once data loads
  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.includes(model)) {
      setModel(availableModels[0]);
    }
  }, [availableModels]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || !agentId || isLoading) return;

    setError(null);
    addMessage(agentId, { role: "user", content });
    setInput("");

    try {
      const result = await chatMutation.mutateAsync({
        agentId,
        messages: [{ role: "user", content }],
        model,
      });

      addMessage(agentId, { role: "assistant", content: result.reply });
      setLastMeta({
        modelUsed:     result.modelUsed,
        tokens:        result.tokens,
        contextLength: result.contextLength,
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось получить ответ";
      setError(msg);
    }
  }

  async function handleReset() {
    if (!agentId || isLoading) return;
    setResetting(true);
    setError(null);
    clearMessages(agentId);
    setLastMeta(null);
    try {
      await chatMutation.mutateAsync({ agentId, messages: [], model, reset: true });
    } catch { /* context cleared locally — swallow error */ }
    setResetting(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (agentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-300 border-t-violet-600" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-gray-500">Агент не найден</p>
        <Link to="/agents" className="text-sm text-violet-600 hover:underline">← К агентам</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
        <Link
          to={`/agents/${agentId}`}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-violet-100">
          <Bot className="h-4 w-4 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{agent.name}</p>
          <p className="text-[11px] text-gray-400">Playground — тестирование агента</p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
          Live
        </span>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: controls */}
        <aside className="hidden w-64 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4 lg:flex lg:flex-col lg:gap-4">

          {/* Agent info */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Агент
            </p>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-700">{agent.name}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">
                {agent.type} · {agent.mode}
              </p>
              {agent.rules && (
                <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-gray-500">
                  {agent.rules}
                </p>
              )}
            </div>
          </div>

          {/* Model select */}
          <div>
            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Модель
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:opacity-50"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Reset */}
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={isLoading || messages.length === 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", resetting && "animate-spin")} />
            Сбросить контекст
          </button>

          {/* Context info */}
          {lastMeta && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-[11px] text-gray-500 space-y-1">
              <p className="font-medium text-gray-600 mb-1.5">Debug</p>
              <p>Model: <span className="font-mono text-gray-700">{lastMeta.modelUsed}</span></p>
              <p>Tokens: <span className="font-mono text-gray-700">{lastMeta.tokens.total}</span></p>
              <p>Context: <span className="font-mono text-gray-700">{lastMeta.contextLength}</span> msgs</p>
            </div>
          )}
        </aside>

        {/* CENTER: chat */}
        <main className="flex flex-1 flex-col overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100">
                  <Bot className="h-7 w-7 text-violet-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Начните диалог</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Агент: <span className="font-medium text-gray-600">{agent.name}</span>
                    {agent.rules ? " · правила заданы" : " · без системного промпта"}
                  </p>
                </div>
                <p className="max-w-sm text-[11px] text-gray-400">
                  Enter → отправить · Shift+Enter → новая строка
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <MessageBubble key={i} role={msg.role} content={msg.content} />
              ))
            )}
            {isLoading && !resetting && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              <span>❌</span>
              <span>{error}</span>
              <button
                type="button"
                className="ml-auto text-red-400 hover:text-red-600"
                onClick={() => setError(null)}
              >×</button>
            </div>
          )}

          {/* Debug panel */}
          <DebugPanel meta={lastMeta} />

          {/* Mobile: model + reset */}
          <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 lg:hidden">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isLoading}
              className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-violet-400 disabled:opacity-50"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleReset()}
              disabled={isLoading || messages.length === 0}
              title="Сбросить контекст"
              className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-red-200 hover:text-red-500 disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", resetting && "animate-spin")} />
            </button>
          </div>

          {/* Input area */}
          <div className="border-t border-gray-200 bg-white p-3">
            <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={1}
                placeholder="Напишите сообщение… (Enter — отправить, Shift+Enter — перенос)"
                className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:opacity-50 max-h-[8rem] overflow-y-auto"
                style={{ minHeight: "1.5rem" }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                }}
              />
              <button
                type="button"
                onClick={() => void sendMessage(input)}
                disabled={isLoading || !input.trim()}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isLoading && !resetting ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
