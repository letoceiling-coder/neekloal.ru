import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Sparkles, Wand2, X, ChevronDown } from "lucide-react";
import { useAuthStore } from "../stores/authStore";

const API = import.meta.env.VITE_API_URL ?? "/api";

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

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

const PRESET_SIZES = [
  { label: "1:1", w: 1024, h: 1024 },
  { label: "16:9", w: 1344, h: 768 },
  { label: "9:16", w: 768, h: 1344 },
  { label: "4:3", w: 1024, h: 768 },
];

const STYLE_PRESETS = [
  { label: "Cinematic", value: "cinematic", suffix: "cinematic lighting, film grain, dramatic shadows" },
  { label: "Pixar 3D", value: "pixar", suffix: "Pixar 3D animation style, vibrant colors, smooth shading" },
  { label: "Realistic", value: "realistic", suffix: "photorealistic, hyperdetailed, DSLR photo" },
  { label: "Anime", value: "anime", suffix: "anime art style, vibrant colors, cel shading" },
];

const PROMPT_EXAMPLES = [
  "кот в сапогах",
  "modern SaaS dashboard, dark UI",
  "cozy coffee shop, warm light",
  "abstract neon geometric art",
];

function StatusBadge({ status }: { status: ImageJob["status"] }) {
  const map: Record<ImageJob["status"], { label: string; cls: string }> = {
    queued:    { label: "В очереди",  cls: "bg-neutral-100 text-neutral-600" },
    waiting:   { label: "Ожидание",   cls: "bg-neutral-100 text-neutral-600" },
    active:    { label: "Генерация…", cls: "bg-blue-50 text-blue-700 animate-pulse" },
    completed: { label: "Готово",     cls: "bg-green-50 text-green-700" },
    failed:    { label: "Ошибка",     cls: "bg-red-50 text-red-600" },
  };
  const { label, cls } = map[status] ?? map.failed;
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>
      {label}
    </span>
  );
}

export function ImageStudioPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const headers = { Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" };

  const [prompt, setPrompt] = useState("");
  const [enhancedPrompt, setEnhancedPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [style, setStyle] = useState<string>("");
  const [showNegative, setShowNegative] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [size, setSize] = useState(PRESET_SIZES[0]);
  const [generating, setGenerating] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ImageJob | null>(null);
  const [history, setHistory] = useState<ImageJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (!activeJobId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollJob(activeJobId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJobId]);

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
      if (job.status === "completed" || job.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setGenerating(false);
        setActiveJobId(null);
        await loadHistory();
      }
    } catch { /* ignore */ }
  }

  async function handleEnhance() {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    setError(null);
    try {
      const res = await fetch(`${API}/image/enhance`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: prompt.trim(), style: style || undefined }),
      });
      const data = await res.json() as { enhancedPrompt?: string; negativePrompt?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Ошибка улучшения промпта");
        return;
      }
      if (data.enhancedPrompt) setEnhancedPrompt(data.enhancedPrompt);
      if (data.negativePrompt) {
        setNegativePrompt(data.negativePrompt);
        setShowNegative(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setEnhancing(false);
    }
  }

  async function handleGenerate() {
    const finalPrompt = enhancedPrompt.trim() || prompt.trim();
    if (!finalPrompt || generating) return;
    setError(null);
    setGenerating(true);
    setActiveJob(null);

    try {
      const body: Record<string, unknown> = {
        prompt: finalPrompt,
        width: size.w,
        height: size.h,
      };
      // If we already have enhanced prompt + negative, skip auto-enhance on backend
      if (enhancedPrompt.trim() && negativePrompt.trim()) {
        body.negativePrompt = negativePrompt.trim();
      } else if (style) {
        body.style = style;
      }

      const res = await fetch(`${API}/image/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json() as { jobId?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Ошибка запуска генерации");
        setGenerating(false);
        return;
      }
      setActiveJobId(data.jobId!);
      setActiveJob({
        jobId: data.jobId!,
        status: "queued",
        prompt: finalPrompt,
        width: size.w,
        height: size.h,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setGenerating(false);
    }
  }

  const canGenerate = !!(enhancedPrompt.trim() || prompt.trim()) && !generating;

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 md:flex-row">
      {/* ── Left panel — controls ── */}
      <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-neutral-200 bg-white p-5 md:w-80 md:border-b-0 md:border-r">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
            <ImageIcon className="h-5 w-5 text-violet-500" />
            Image Studio
          </h1>
          <p className="mt-0.5 text-xs text-neutral-500">AI генерация через SDXL + умный промпт</p>
        </div>

        {/* Raw prompt */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Описание</label>
          <textarea
            className="min-h-[80px] w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-900 placeholder-neutral-400 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
            placeholder="Например: кот в сапогах"
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setEnhancedPrompt(""); setNegativePrompt(""); }}
          />
          <div className="flex flex-wrap gap-1 pt-0.5">
            {PROMPT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setPrompt(ex); setEnhancedPrompt(""); setNegativePrompt(""); }}
                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500 transition hover:border-violet-300 hover:text-violet-600"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Style preset */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Стиль</label>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(style === s.value ? "" : s.value)}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-xs font-medium transition text-left",
                  style === s.value
                    ? "border-violet-400 bg-violet-50 text-violet-700"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Enhance button */}
        <button
          type="button"
          disabled={!prompt.trim() || enhancing}
          onClick={handleEnhance}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition",
            !prompt.trim() || enhancing
              ? "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400"
              : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 active:scale-[0.98]"
          )}
        >
          {enhancing ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Улучшаем…</>
          ) : (
            <><Wand2 className="h-4 w-4" /> ✨ Улучшить промпт</>
          )}
        </button>

        {/* Enhanced prompt (editable) */}
        {enhancedPrompt && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-amber-700">Улучшенный промпт</label>
              <button
                type="button"
                onClick={() => { setEnhancedPrompt(""); setNegativePrompt(""); setShowNegative(false); }}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              className="min-h-[80px] w-full resize-none rounded-lg border border-amber-200 bg-white p-2 text-xs text-neutral-800 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-200"
              value={enhancedPrompt}
              onChange={(e) => setEnhancedPrompt(e.target.value)}
            />

            {/* Negative prompt toggle */}
            <button
              type="button"
              onClick={() => setShowNegative((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 mt-0.5"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", showNegative && "rotate-180")} />
              Negative prompt
            </button>
            {showNegative && (
              <textarea
                className="min-h-[50px] w-full resize-none rounded-lg border border-red-200 bg-white p-2 text-[11px] text-neutral-700 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100"
                placeholder="Что исключить из изображения…"
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
              />
            )}
          </div>
        )}

        {/* Size presets */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Соотношение сторон</label>
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
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:border-neutral-300"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400">{size.w} × {size.h} px</p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Generate button */}
        <button
          type="button"
          disabled={!canGenerate}
          onClick={handleGenerate}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition",
            !canGenerate
              ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
              : "bg-violet-600 text-white shadow-sm hover:bg-violet-700 active:scale-[0.98]"
          )}
        >
          {generating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Генерация…</>
          ) : (
            <><Sparkles className="h-4 w-4" /> Сгенерировать</>
          )}
        </button>
      </div>

      {/* ── Center — preview ── */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-neutral-50 p-6">
        {generating && activeJob?.status !== "completed" ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-48 w-48 rounded-2xl border-2 border-dashed border-violet-200 bg-white" />
              <Loader2 className="absolute inset-0 m-auto h-10 w-10 animate-spin text-violet-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-neutral-700">
                {activeJob?.status === "active" ? "Рисуем…" : "В очереди…"}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400 max-w-sm">
                {activeJob?.prompt?.slice(0, 100)}
              </p>
            </div>
          </div>
        ) : activeJob?.status === "completed" && activeJob.url ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={activeJob.url}
              alt={activeJob.prompt}
              className="max-h-[500px] max-w-full cursor-zoom-in rounded-2xl border border-neutral-200 shadow-md transition hover:shadow-lg"
              onClick={() => setSelectedImage(activeJob.url!)}
            />
            <p className="max-w-md text-center text-xs text-neutral-500 italic">
              "{activeJob.originalPrompt ?? activeJob.prompt}"
            </p>
            <a
              href={activeJob.url}
              download
              className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
            >
              Скачать
            </a>
          </div>
        ) : activeJob?.status === "failed" ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-48 w-48 rounded-2xl border-2 border-dashed border-red-200 bg-white flex items-center justify-center">
              <X className="h-12 w-12 text-red-300" />
            </div>
            <p className="text-sm text-red-600">{activeJob.error ?? "Ошибка генерации"}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="rounded-2xl border-2 border-dashed border-neutral-200 bg-white p-12">
              <ImageIcon className="mx-auto h-12 w-12 text-neutral-300" />
              <p className="mt-3 text-sm font-medium text-neutral-400">Image Studio</p>
            </div>
            <div className="flex flex-col gap-1 text-center">
              <p className="text-sm text-neutral-400">Введите описание → нажмите <span className="font-medium text-amber-600">✨ Улучшить</span></p>
              <p className="text-xs text-neutral-300">или сразу нажмите <span className="font-medium text-violet-500">Сгенерировать</span></p>
            </div>
          </div>
        )}
      </div>

      {/* ── Right — history ── */}
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
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-neutral-300" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-4">Пока нет генераций</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((job) => (
              <div
                key={job.jobId}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-2.5 transition",
                  job.url ? "cursor-pointer hover:border-violet-200 hover:bg-violet-50/40" : "opacity-70",
                  "border-neutral-200 bg-neutral-50"
                )}
                onClick={() => job.url && setSelectedImage(job.url)}
              >
                {job.url ? (
                  <img
                    src={job.url}
                    alt={job.prompt}
                    className="w-full rounded-lg border border-neutral-200 object-cover"
                    style={{ aspectRatio: `${job.width}/${job.height}`, maxHeight: 120 }}
                  />
                ) : (
                  <div className="flex items-center justify-center rounded-lg bg-neutral-100" style={{ height: 60 }}>
                    {job.status === "active" || job.status === "queued" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                    ) : (
                      <X className="h-4 w-4 text-red-300" />
                    )}
                  </div>
                )}
                <StatusBadge status={job.status} />
                <p className="line-clamp-2 text-[11px] text-neutral-500 leading-snug">
                  {job.originalPrompt ?? job.prompt}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            onClick={() => setSelectedImage(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={selectedImage}
            alt=""
            className="max-h-full max-w-full rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
