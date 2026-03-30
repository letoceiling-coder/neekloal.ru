import { useEffect, useRef, useState } from "react";
import {
  ImageIcon, Loader2, RefreshCw, Sparkles, X,
  Download, Trash2, RotateCcw, Eye, Zap, Info,
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";

const API = import.meta.env.VITE_API_URL ?? "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImageJob {
  jobId: string;
  status: "queued" | "waiting" | "active" | "completed" | "failed";
  prompt: string;
  originalPrompt?: string;
  negativePrompt?: string;
  width: number;
  height: number;
  url?: string;
  error?: string;
  createdAt: string;
}

type GenStage = "idle" | "enhancing" | "queuing" | "rendering" | "done";

// ── Constants ─────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

const PRESET_SIZES = [
  { label: "1:1",  w: 1024, h: 1024 },
  { label: "16:9", w: 1344, h: 768  },
  { label: "9:16", w: 768,  h: 1344 },
  { label: "4:3",  w: 1024, h: 768  },
];

const STYLE_PRESETS = [
  { label: "Cinematic", value: "cinematic", desc: "Киношный свет, глубина",    emoji: "🎬" },
  { label: "Pixar 3D",  value: "pixar",     desc: "Мультяшный 3D стиль",       emoji: "🎨" },
  { label: "Realistic", value: "realistic", desc: "Фотореализм",               emoji: "📷" },
  { label: "Anime",     value: "anime",     desc: "Аниме стиль",               emoji: "⛩️" },
];

const PROMPT_EXAMPLES = [
  "кот в сапогах",
  "modern SaaS dashboard",
  "cozy coffee shop",
  "neon geometric art",
];

const STAGE_LABELS: Record<GenStage, string> = {
  idle:      "",
  enhancing: "✨ Улучшаем промпт…",
  queuing:   "Отправляем в очередь…",
  rendering: "Рисуем…",
  done:      "Готово",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ImageJob["status"] }) {
  const map: Record<ImageJob["status"], { label: string; cls: string }> = {
    queued:    { label: "В очереди",  cls: "bg-neutral-100 text-neutral-500" },
    waiting:   { label: "Ожидание",   cls: "bg-neutral-100 text-neutral-500" },
    active:    { label: "Генерация…", cls: "bg-blue-50 text-blue-600 animate-pulse" },
    completed: { label: "Готово",     cls: "bg-green-50 text-green-700" },
    failed:    { label: "Ошибка",     cls: "bg-red-50 text-red-600" },
  };
  const { label, cls } = map[status] ?? map.failed;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", cls)}>
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImageStudioPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const headers = { Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" };

  // Controls
  const [prompt, setPrompt]         = useState("");
  const [style, setStyle]           = useState("");
  const [size, setSize]             = useState(PRESET_SIZES[0]);
  const [autoEnhance, setAutoEnhance] = useState(true);
  const [smartMode, setSmartMode]   = useState(true);

  // Generation state
  const [genStage, setGenStage]     = useState<GenStage>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob]   = useState<ImageJob | null>(null);
  const [lastEnhanced, setLastEnhanced] = useState<{ prompt: string; negative: string } | null>(null);
  const [showEnhancedPrompt, setShowEnhancedPrompt] = useState(false);

  // UI state
  const [history, setHistory]       = useState<ImageJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [lightbox, setLightbox]     = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ jobId: string; url?: string } | null>(null);
  const [deleting, setDeleting]     = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generating = genStage !== "idle" && genStage !== "done";

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (!activeJobId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollJob(activeJobId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJobId]);

  // Smart mode: keep autoEnhance in sync
  useEffect(() => {
    if (smartMode) setAutoEnhance(true);
  }, [smartMode]);

  // ── API helpers ──────────────────────────────────────────────────────────────

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/image/list`, { headers });
      if (res.ok) {
        const data = await res.json() as { items: ImageJob[] };
        setHistory(data.items ?? []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(`${API}/image/status/${jobId}`, { headers });
      if (!res.ok) return;
      const job = await res.json() as ImageJob;
      setActiveJob(job);
      if (job.status === "active") setGenStage("rendering");
      if (job.status === "completed" || job.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setGenStage("done");
        setActiveJobId(null);
        await loadHistory();
      }
    } catch { /* ignore */ }
  }

  // ── Generate (1-click flow) ──────────────────────────────────────────────────

  async function handleGenerate(overridePrompt?: string) {
    const rawPrompt = (overridePrompt ?? prompt).trim();
    if (!rawPrompt || generating) return;

    setError(null);
    setLastEnhanced(null);
    setShowEnhancedPrompt(false);
    setActiveJob(null);

    const shouldEnhance = smartMode || autoEnhance;

    try {
      let finalPrompt = rawPrompt;
      let finalNegative: string | undefined;

      // Step 1: enhance if enabled
      if (shouldEnhance) {
        setGenStage("enhancing");
        const res = await fetch(`${API}/image/enhance`, {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt: rawPrompt, style: style || undefined }),
        });
        if (res.ok) {
          const data = await res.json() as { enhancedPrompt?: string; negativePrompt?: string };
          if (data.enhancedPrompt) {
            finalPrompt = data.enhancedPrompt;
            finalNegative = data.negativePrompt;
            setLastEnhanced({ prompt: data.enhancedPrompt, negative: data.negativePrompt ?? "" });
          }
        }
        // Even if enhance fails, we continue with original prompt
      }

      // Step 2: queue generation
      setGenStage("queuing");
      const body: Record<string, unknown> = {
        prompt: finalPrompt,
        width: size.w,
        height: size.h,
      };
      if (finalNegative) body.negativePrompt = finalNegative;
      if (!shouldEnhance && style) body.style = style;

      const res = await fetch(`${API}/image/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json() as { jobId?: string; error?: string };

      if (!res.ok) {
        setError(data.error ?? "Ошибка запуска генерации");
        setGenStage("idle");
        return;
      }

      setGenStage("rendering");
      setActiveJobId(data.jobId!);
      setActiveJob({
        jobId: data.jobId!,
        status: "queued",
        prompt: finalPrompt,
        originalPrompt: rawPrompt,
        width: size.w,
        height: size.h,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setGenStage("idle");
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async function handleDelete(jobId: string) {
    setDeleting(true);
    try {
      const res = await fetch(`${API}/image/${jobId}`, { method: "DELETE", headers });
      if (res.ok) {
        setHistory((prev) => prev.filter((j) => j.jobId !== jobId));
        if (activeJob?.jobId === jobId) { setActiveJob(null); setGenStage("idle"); }
        if (lightbox) setLightbox(null);
      } else {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Ошибка удаления");
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setDeleting(false);
      setDeleteModal(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const canGenerate = !!prompt.trim() && !generating;

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 md:flex-row">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════════ */}
      <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-neutral-200 bg-white p-5 md:w-80 md:border-b-0 md:border-r">

        {/* Header + Smart Mode toggle */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
              <ImageIcon className="h-5 w-5 text-violet-500" />
              Image Studio
            </h1>
            <p className="mt-0.5 text-xs text-neutral-500">Генерация изображений через SDXL</p>
          </div>
          <button
            type="button"
            onClick={() => setSmartMode((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
              smartMode
                ? "border-violet-400 bg-violet-600 text-white shadow-sm"
                : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            Smart
          </button>
        </div>

        {/* Prompt textarea */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Описание</label>
          <textarea
            className="min-h-[90px] w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-900 placeholder-neutral-400 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
            placeholder="Например: кот в сапогах…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          />
          <div className="flex flex-wrap gap-1">
            {PROMPT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500 transition hover:border-violet-300 hover:text-violet-600"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Style cards */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Стиль</label>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(style === s.value ? "" : s.value)}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl border p-2.5 text-left transition",
                  style === s.value
                    ? "border-violet-400 bg-violet-50"
                    : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-white"
                )}
              >
                <span className="text-base leading-none">{s.emoji}</span>
                <span className={cn("text-xs font-semibold", style === s.value ? "text-violet-700" : "text-neutral-700")}>
                  {s.label}
                </span>
                <span className="text-[10px] text-neutral-400 leading-tight">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Size presets */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Формат</label>
          <div className="grid grid-cols-4 gap-1.5">
            {PRESET_SIZES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSize(s)}
                className={cn(
                  "rounded-lg border py-1.5 text-xs font-medium transition",
                  size.label === s.label
                    ? "border-violet-400 bg-violet-50 text-violet-700"
                    : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400">{size.w} × {size.h} px</p>
        </div>

        {/* Auto-enhance toggle (visible only when smart mode off) */}
        {!smartMode && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={autoEnhance}
              onChange={(e) => setAutoEnhance(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-300 accent-violet-600"
            />
            <span className="text-xs text-neutral-600">Улучшать промпт автоматически</span>
          </label>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-700">Ошибка генерации</p>
              <p className="mt-0.5 text-xs text-red-500">{error}</p>
            </div>
          </div>
        )}

        {/* Generate button */}
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => handleGenerate()}
          className={cn(
            "relative flex items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition",
            !canGenerate
              ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
              : "bg-violet-600 text-white shadow-sm hover:bg-violet-700 active:scale-[0.98]"
          )}
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {STAGE_LABELS[genStage]}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Сгенерировать
              {(smartMode || autoEnhance) && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-medium">+AI</span>
              )}
            </>
          )}
        </button>

        {/* Smart mode hint */}
        {smartMode && (
          <p className="flex items-center gap-1 text-[11px] text-neutral-400">
            <Info className="h-3 w-3" />
            Smart Mode: промпт улучшается автоматически
          </p>
        )}
      </div>

      {/* ══ CENTER PREVIEW ══════════════════════════════════════════════════════ */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-neutral-50 p-6">

        {/* Generating state */}
        {generating ? (
          <div className="flex flex-col items-center gap-5">
            <div className="relative">
              <div className="h-52 w-52 rounded-2xl border-2 border-dashed border-violet-200 bg-white" />
              <Loader2 className="absolute inset-0 m-auto h-10 w-10 animate-spin text-violet-400" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-semibold text-neutral-700">{STAGE_LABELS[genStage]}</p>
              <p className="max-w-xs text-center text-xs text-neutral-400">
                {activeJob?.originalPrompt ?? prompt}
              </p>
              {/* Progress steps */}
              <div className="mt-1 flex items-center gap-2">
                {(["enhancing", "queuing", "rendering"] as GenStage[]).map((s, i) => (
                  <div key={s} className="flex items-center gap-2">
                    {i > 0 && <div className="h-px w-6 bg-neutral-200" />}
                    <div className={cn(
                      "h-2 w-2 rounded-full transition-all",
                      genStage === s ? "scale-125 bg-violet-500" :
                      (["queuing", "rendering"].indexOf(genStage) > i - 1 || genStage === "done")
                        ? "bg-violet-300" : "bg-neutral-200"
                    )} />
                  </div>
                ))}
              </div>
            </div>
          </div>

        /* Completed */
        ) : activeJob?.status === "completed" && activeJob.url ? (
          <div className="flex flex-col items-center gap-3">
            {/* Enhanced prompt badge */}
            {lastEnhanced && (
              <div className="flex w-full max-w-lg items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <span className="text-xs font-medium text-amber-700">✨ Промпт улучшен автоматически</span>
                <button
                  type="button"
                  onClick={() => setShowEnhancedPrompt((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-800"
                >
                  <Eye className="h-3 w-3" />
                  {showEnhancedPrompt ? "Скрыть" : "Показать"}
                </button>
              </div>
            )}
            {showEnhancedPrompt && lastEnhanced && (
              <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-3">
                <p className="text-[11px] font-medium text-neutral-500 mb-1">Улучшенный промпт:</p>
                <p className="text-xs text-neutral-700 leading-relaxed">{lastEnhanced.prompt}</p>
              </div>
            )}

            {/* Image with hover overlay */}
            <div className="group relative">
              <img
                src={activeJob.url}
                alt={activeJob.prompt}
                className="max-h-[480px] max-w-full cursor-zoom-in rounded-2xl border border-neutral-200 shadow-md"
                onClick={() => setLightbox(activeJob.url!)}
              />
              {/* Overlay actions */}
              <div className="absolute inset-0 flex items-end justify-center rounded-2xl bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex gap-2">
                  <a
                    href={activeJob.url}
                    download
                    className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-800 shadow transition hover:bg-white"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать
                  </a>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleGenerate(activeJob.originalPrompt ?? prompt); }}
                    className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-800 shadow transition hover:bg-white"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Перегенерировать
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteModal({ jobId: activeJob.jobId, url: activeJob.url }); }}
                    className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </button>
                </div>
              </div>
            </div>

            <p className="max-w-md text-center text-xs text-neutral-400 italic">
              "{activeJob.originalPrompt ?? activeJob.prompt}"
            </p>
          </div>

        /* Failed */
        ) : activeJob?.status === "failed" ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-red-200 bg-white">
              <X className="h-12 w-12 text-red-300" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-red-600">Ошибка генерации</p>
              <p className="mt-1 max-w-xs text-xs text-neutral-400">
                {activeJob.error && !activeJob.error.includes("[object")
                  ? activeJob.error
                  : "Попробуйте изменить описание или выбрать другой стиль"}
              </p>
              <button
                type="button"
                onClick={() => handleGenerate()}
                className="mt-3 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-xs font-medium text-neutral-600 transition hover:border-violet-300 hover:text-violet-600 mx-auto"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Попробовать снова
              </button>
            </div>
          </div>

        /* Empty state */
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-3xl border-2 border-dashed border-neutral-200 bg-white p-14">
              <ImageIcon className="mx-auto h-14 w-14 text-neutral-200" />
            </div>
            <div>
              <p className="text-sm font-semibold text-neutral-600">Введите описание и нажмите Сгенерировать</p>
              <p className="mt-1 text-xs text-neutral-400">
                {smartMode
                  ? "Smart Mode: промпт улучшится автоматически"
                  : "Или включите Smart Mode для лучшего результата"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ══ RIGHT HISTORY ═══════════════════════════════════════════════════════ */}
      <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-neutral-200 bg-white p-4 md:w-64 md:border-l md:border-t-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">История</p>
          <button
            type="button"
            onClick={loadHistory}
            className="rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {historyLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
          </div>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-400">Пока нет генераций</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((job) => (
              <HistoryCard
                key={job.jobId}
                job={job}
                onOpen={() => job.url && setLightbox(job.url)}
                onDelete={() => setDeleteModal({ jobId: job.jobId, url: job.url })}
                onRegenerate={() => handleGenerate(job.originalPrompt ?? job.prompt)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══ LIGHTBOX ════════════════════════════════════════════════════════════ */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ══ DELETE MODAL ════════════════════════════════════════════════════════ */}
      {deleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setDeleteModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-6 w-6 text-red-500" />
              </div>
              <div>
                <p className="font-semibold text-neutral-900">Удалить изображение?</p>
                <p className="mt-1 text-sm text-neutral-500">Файл будет удалён безвозвратно</p>
              </div>
              <div className="flex w-full gap-3">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteModal(null)}
                  className="flex-1 rounded-xl border border-neutral-200 bg-neutral-50 py-2.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleDelete(deleteModal.jobId)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Удалить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History card ──────────────────────────────────────────────────────────────

function HistoryCard({
  job,
  onOpen,
  onDelete,
  onRegenerate,
}: {
  job: ImageJob;
  onOpen: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-2 transition hover:border-neutral-300 hover:bg-white">
      {/* Thumbnail */}
      {job.url ? (
        <div className="relative cursor-pointer overflow-hidden rounded-lg" onClick={onOpen}>
          <img
            src={job.url}
            alt={job.prompt}
            className="w-full object-cover transition group-hover:brightness-95"
            style={{ aspectRatio: `${job.width}/${job.height}`, maxHeight: 110 }}
          />
          {/* hover actions overlay */}
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="Открыть"
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="rounded-full bg-white/90 p-1.5 transition hover:bg-white"
            >
              <Eye className="h-3.5 w-3.5 text-neutral-700" />
            </button>
            <button
              type="button"
              title="Перегенерировать"
              onClick={(e) => { e.stopPropagation(); onRegenerate(); }}
              className="rounded-full bg-white/90 p-1.5 transition hover:bg-white"
            >
              <RotateCcw className="h-3.5 w-3.5 text-neutral-700" />
            </button>
            <button
              type="button"
              title="Удалить"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="rounded-full bg-red-500/90 p-1.5 transition hover:bg-red-500"
            >
              <Trash2 className="h-3.5 w-3.5 text-white" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded-lg bg-neutral-100"
          style={{ height: 56 }}
        >
          {job.status === "active" || job.status === "queued" || job.status === "waiting" ? (
            <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
          ) : (
            <X className="h-4 w-4 text-red-300" />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-1">
        <StatusBadge status={job.status} />
        {job.status === "failed" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-neutral-300 transition hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="line-clamp-2 text-[11px] leading-snug text-neutral-500">
        {job.originalPrompt ?? job.prompt}
      </p>
    </div>
  );
}
