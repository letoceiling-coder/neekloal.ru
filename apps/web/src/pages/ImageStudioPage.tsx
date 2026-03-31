import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ImageIcon, Loader2, RefreshCw, Sparkles, X,
  Download, Trash2, RotateCcw, Eye, Info,
  Layers, SlidersHorizontal, Paintbrush, Upload, Settings2, Scissors,
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";

const API = import.meta.env.VITE_API_URL ?? "/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageMode = "text" | "variation" | "reference" | "inpaint" | "controlnet";
type ControlType = "canny" | "pose";

interface ImageJob {
  /** DB record id (preferred for delete) or BullMQ job id for legacy */
  id?: string;
  jobId: string;
  status: "queued" | "waiting" | "active" | "completed" | "failed";
  mode?: ImageMode;
  prompt: string;
  originalPrompt?: string;
  negativePrompt?: string;
  style?: string;
  aspectRatio?: string;
  width: number;
  height: number;
  url?: string;
  urls?: string[];
  dbIds?: string[];
  count?: number;
  error?: string;
  createdAt: string;
}

interface EnhanceApplied {
  style: string | null;
  aspectRatio: string | null;
  systemPrompt: boolean;
}

interface BrainResult {
  type: string;
  style: string;
  composition: string;
  suggestedSize?: { w: number; h: number };
}

interface RefImage {
  previewUrl: string;
  refUrl: string;
}

type GenStage = "idle" | "enhancing" | "uploading" | "queuing" | "rendering" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  { label: "Cinematic", value: "cinematic", desc: "Киношный свет, глубина",  emoji: "🎬" },
  { label: "Pixar 3D",  value: "pixar",     desc: "Мультяшный 3D стиль",     emoji: "🎨" },
  { label: "Realistic", value: "realistic", desc: "Фотореализм",             emoji: "📷" },
  { label: "Anime",     value: "anime",     desc: "Аниме стиль",             emoji: "⛩️" },
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
  uploading: "📤 Загружаем изображение…",
  queuing:   "Отправляем в очередь…",
  rendering: "Рисуем…",
  done:      "Готово",
};

const CONTROL_TYPES: { id: ControlType; label: string; hint: string }[] = [
  { id: "canny", label: "Контур (Canny)", hint: "Строгий контурный контроль — идеально для архитектуры, объектов" },
  { id: "pose",  label: "Поза (Pose)",    hint: "Контроль положения тела — идеально для персонажей" },
];

/** Режим генерации (производный): не путать с smartMode. */
function computeResolvedMode(
  enableVariations: boolean,
  enableControlNet: boolean,
  referenceImage: RefImage | null,
  maskImage: RefImage | null
): ImageMode {
  if (enableVariations) return "variation";
  if (enableControlNet && referenceImage?.refUrl) return "controlnet";
  if (maskImage?.refUrl && referenceImage?.refUrl) return "inpaint";
  if (referenceImage?.refUrl) return "reference";
  return "text";
}

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

function ImageUploadBox({
  label,
  hint,
  image,
  uploading,
  onSelect,
}: {
  label: string;
  hint?: string;
  image: RefImage | null;
  uploading: boolean;
  onSelect: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="text-xs font-medium text-neutral-700 break-words">{label}</label>
      {hint && <p className="text-[11px] text-neutral-400 break-words [overflow-wrap:anywhere]">{hint}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative flex min-h-[90px] w-full items-center justify-center rounded-xl border-2 border-dashed transition",
          image
            ? "border-violet-300 bg-violet-50"
            : "border-neutral-200 bg-neutral-50 hover:border-violet-300 hover:bg-violet-50"
        )}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
        ) : image ? (
          <img
            src={image.previewUrl}
            alt=""
            className="max-h-[80px] w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-neutral-400">
            <Upload className="h-6 w-6" />
            <span className="text-xs">Нажмите для загрузки</span>
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImageStudioPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const headers = { Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" };

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [size, setSize] = useState(PRESET_SIZES[0]);
  const [smartMode, setSmartMode] = useState(true);
  const [enableVariations, setEnableVariations] = useState(false);
  const [enableReference, setEnableReference] = useState(false);
  const [enableInpaint, setEnableInpaint] = useState(false);
  const [enableControlNet, setEnableControlNet] = useState(false);
  const [controlType, setControlType] = useState<ControlType>("canny");

  const [variationCount, setVariationCount] = useState(4);

  // Reference/Inpaint controls
  const [referenceImage, setReferenceImage] = useState<RefImage | null>(null);
  const [maskImage, setMaskImage]           = useState<RefImage | null>(null);
  const [strength, setStrength]             = useState(0.5);
  const [refUploading, setRefUploading]     = useState(false);
  const [maskUploading, setMaskUploading]   = useState(false);

  // Generation state
  const [genStage, setGenStage]               = useState<GenStage>("idle");
  const [activeJobId, setActiveJobId]         = useState<string | null>(null);
  const [activeJob, setActiveJob]             = useState<ImageJob | null>(null);
  const [lastEnhanced, setLastEnhanced]       = useState<{ prompt: string; negative: string } | null>(null);
  const [showEnhancedPrompt, setShowEnhancedPrompt] = useState(false);
  const [enhanceApplied, setEnhanceApplied]   = useState<EnhanceApplied | null>(null);
  const [brainResult, setBrainResult]         = useState<BrainResult | null>(null);

  // UI state
  const [history, setHistory]               = useState<ImageJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [lightbox, setLightbox]             = useState<string | null>(null);
  const [deleteModal, setDeleteModal]       = useState<{ id: string; jobId: string; url?: string } | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [removingBg, setRemovingBg]         = useState(false);
  const [removeBgResult, setRemoveBgResult] = useState<{ url: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generating = genStage !== "idle" && genStage !== "done";

  const resolvedMode = useMemo(
    () => computeResolvedMode(enableVariations, enableControlNet, referenceImage, maskImage),
    [enableVariations, enableControlNet, referenceImage, maskImage]
  );

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (!activeJobId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollJob(activeJobId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJobId]);

  useEffect(() => {
    if (!enableReference && !enableInpaint && !enableControlNet) setReferenceImage(null);
  }, [enableReference, enableInpaint, enableControlNet]);

  useEffect(() => {
    if (!enableInpaint) setMaskImage(null);
  }, [enableInpaint]);

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
      // Prefer first DB id as the canonical id for operations
      if (job.dbIds?.length) job.id = job.dbIds[0];
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

  async function uploadRefFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API}/image/upload-ref`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      body: formData,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({} as { error?: string }));
      throw new Error(d.error ?? "Ошибка загрузки файла");
    }
    const data = await res.json() as { refUrl: string };
    return data.refUrl;
  }

  async function handleSelectRef(file: File) {
    setRefUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const refUrl = await uploadRefFile(file);
      setReferenceImage({ previewUrl, refUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки изображения");
    } finally {
      setRefUploading(false);
    }
  }

  async function handleSelectMask(file: File) {
    setMaskUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const refUrl = await uploadRefFile(file);
      setMaskImage({ previewUrl, refUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки маски");
    } finally {
      setMaskUploading(false);
    }
  }

  // ── Generate ─────────────────────────────────────────────────────────────────

  async function handleGenerate(overridePrompt?: string) {
    const rawPrompt = (overridePrompt ?? prompt).trim();
    if (!rawPrompt || generating) return;

    setError(null);
    setLastEnhanced(null);
    setShowEnhancedPrompt(false);
    setEnhanceApplied(null);
    setBrainResult(null);
    setActiveJob(null);

    const modeForJob = computeResolvedMode(enableVariations, enableControlNet, referenceImage, maskImage);
    const shouldEnhance = smartMode;

    try {
      let finalPrompt = rawPrompt;
      let finalNegative: string | undefined;

      if (shouldEnhance) {
        setGenStage("enhancing");
        const res = await fetch(`${API}/image/enhance`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: rawPrompt,
            style: style || undefined,
            aspectRatio: `${size.w}:${size.h}`,
          }),
        });
        if (res.ok) {
          const data = await res.json() as {
            enhancedPrompt?: string;
            negativePrompt?: string;
            appliedStyle?: string | null;
            appliedAspectRatio?: string | null;
            appliedSystemPrompt?: boolean;
            brain?: BrainResult | null;
          };
          if (data.enhancedPrompt) {
            finalPrompt = data.enhancedPrompt;
            finalNegative = data.negativePrompt;
            setLastEnhanced({ prompt: data.enhancedPrompt, negative: data.negativePrompt ?? "" });
            setEnhanceApplied({
              style: data.appliedStyle ?? null,
              aspectRatio: data.appliedAspectRatio ?? null,
              systemPrompt: data.appliedSystemPrompt ?? false,
            });
            if (data.brain) setBrainResult(data.brain);
          }
        }
      }

      setGenStage("queuing");

      const body: Record<string, unknown> = {
        prompt: finalPrompt,
        width: size.w,
        height: size.h,
        mode: modeForJob,
        smartMode,
        variations: enableVariations ? variationCount : 1,
        aspectRatio: `${size.w}:${size.h}`,
        ...(modeForJob === "controlnet" ? { controlType } : {}),
      };

      if (finalNegative) body.negativePrompt = finalNegative;
      if (style) body.style = style;

      if (modeForJob === "reference" || modeForJob === "inpaint") {
        body.referenceImageUrl = referenceImage?.refUrl;
        body.strength = strength;
      }
      if (modeForJob === "inpaint") {
        body.maskUrl = maskImage?.refUrl;
      }

      const res = await fetch(`${API}/image/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        jobId?: string;
        error?: string;
        enhanceApplied?: EnhanceApplied | null;
        brain?: BrainResult | null;
      };

      if (!res.ok) {
        setError(data.error ?? "Ошибка запуска генерации");
        setGenStage("idle");
        return;
      }

      // If server enhanced (backend-only path), capture what was applied
      if (data.enhanceApplied && !enhanceApplied) {
        setEnhanceApplied(data.enhanceApplied);
      }
      if (data.brain) setBrainResult(data.brain);

      setGenStage("rendering");
      setActiveJobId(data.jobId!);
      setActiveJob({
        jobId: data.jobId!,
        status: "queued",
        mode: modeForJob,
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

  async function handleRemoveBg(imageUrl: string) {
    setRemovingBg(true);
    setRemoveBgResult(null);
    try {
      const res = await fetch(`${API}/image/remove-bg`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Не удалось убрать фон");
        return;
      }
      setRemoveBgResult({ url: data.url });
    } catch {
      setError("Ошибка удаления фона");
    } finally {
      setRemovingBg(false);
    }
  }

  async function handleDelete(imageId: string, jobId?: string) {
    setDeleting(true);
    const deleteId = imageId || jobId || "";
    const deleteHeaders = { Authorization: `Bearer ${accessToken ?? ""}` };
    try {
      const res = await fetch(`${API}/image/${deleteId}`, { method: "DELETE", headers: deleteHeaders });
      if (res.ok || res.status === 404) {
        setHistory((prev) => prev.filter((j) => (j.id ?? j.jobId) !== deleteId));
        const match = activeJob?.id === deleteId || activeJob?.jobId === deleteId;
        if (match) { setActiveJob(null); setGenStage("idle"); }
        if (lightbox) setLightbox(null);
      } else {
        const d = await res.json().catch(() => ({} as { error?: string }));
        setError(d.error ?? `Ошибка удаления (HTTP ${res.status})`);
      }
    } catch {
      setError("Ошибка сети");
    } finally {
      setDeleting(false);
      setDeleteModal(null);
    }
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const canGenerate = (() => {
    if (!prompt.trim() || generating) return false;
    if (refUploading || maskUploading) return false;
    if (enableVariations) return true;
    if (enableInpaint) return !!(referenceImage?.refUrl && maskImage?.refUrl);
    if (enableControlNet) return !!referenceImage?.refUrl;
    if (enableReference) return !!referenceImage?.refUrl;
    return true;
  })();

  const resultUrls = activeJob?.urls ?? (activeJob?.url ? [activeJob.url] : []);
  const isMultiResult = resultUrls.length > 1;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col gap-0 md:flex-row">

      {/* ══ LEFT PANEL ══════════════════════════════════════════════════════════ */}
      <div className="flex min-w-0 w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-neutral-200 bg-white p-5 md:w-80 md:border-b-0 md:border-r [overflow-wrap:anywhere]">

        {/* Header */}
        <div className="flex items-center justify-between gap-2 break-words">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 shrink-0 text-violet-500" />
            <h1 className="text-base font-semibold text-neutral-900">Image Studio</h1>
          </div>
          <Link
            to="/image-studio/settings"
            title="Настройки"
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            <Settings2 className="h-4 w-4" />
          </Link>
        </div>

        {/* Режимы: чекбоксы (smartMode ≠ mode) */}
        <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3">
          <p className="text-[11px] font-medium text-neutral-500">Настройки генерации</p>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={smartMode}
              onChange={(e) => setSmartMode(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-violet-600"
            />
            <span className="break-words">Умный режим — улучшать промпт (AI)</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={enableVariations}
              onChange={(e) => setEnableVariations(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-violet-600"
            />
            <span className="break-words">Вариации — несколько картинок за раз</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={enableReference}
              onChange={(e) => setEnableReference(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-violet-600"
            />
            <span className="break-words">По образцу — img2img</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={enableInpaint}
              onChange={(e) => setEnableInpaint(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-violet-600"
            />
            <span className="break-words">Редактирование — маска области</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              checked={enableControlNet}
              onChange={(e) => {
                setEnableControlNet(e.target.checked);
                if (e.target.checked) { setEnableInpaint(false); setEnableReference(false); }
              }}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 accent-violet-600"
            />
            <span className="break-words">🧬 ControlNet — контроль формы/позы</span>
          </label>
        </div>

        {/* ControlNet type + hint */}
        {enableControlNet && (
          <div className="flex flex-col gap-2 rounded-xl border border-violet-100 bg-violet-50 p-3">
            <p className="text-[11px] font-medium text-violet-700">Тип контроля</p>
            <div className="flex flex-col gap-2">
              {CONTROL_TYPES.map((ct) => (
                <label key={ct.id} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="controlType"
                    value={ct.id}
                    checked={controlType === ct.id}
                    onChange={() => setControlType(ct.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                  />
                  <div>
                    <p className="text-xs font-medium text-neutral-800">{ct.label}</p>
                    <p className="text-[10px] text-neutral-500 break-words">{ct.hint}</p>
                  </div>
                </label>
              ))}
            </div>
            <p className="mt-1 flex items-start gap-1 text-[10px] text-violet-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Используйте изображение как основу композиции. Загрузите фото ниже.
            </p>
          </div>
        )}

        <p className="flex items-start gap-1 text-[11px] text-neutral-400 break-words">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Сейчас: {resolvedMode === "text" && "текст → изображение"}
          {resolvedMode === "variation" && "несколько вариантов"}
          {resolvedMode === "reference" && "по загруженному образцу"}
          {resolvedMode === "inpaint" && "замена по маске"}
          {resolvedMode === "controlnet" && `🧬 ControlNet (${controlType})`}
          {smartMode && " · умный промпт включён"}
        </p>

        {/* Prompt textarea */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Описание</label>
          <textarea
            className="min-h-[80px] max-w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-900 placeholder-neutral-400 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 break-words [overflow-wrap:anywhere]"
            placeholder={
              enableInpaint
                ? "Что должно появиться в выделенной области…"
                : "Например: кот в сапогах…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
          />
          <div className="flex flex-wrap gap-2">
            {PROMPT_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setPrompt(ex)}
                className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500 transition hover:border-violet-300 hover:text-violet-600 break-words max-w-full text-left"
              >
                {ex}
              </button>
            ))}
          </div>
          {/* Live brain detection chip */}
          {smartMode && prompt.trim().length > 4 && (
            <PromptBrainChip prompt={prompt} />
          )}
        </div>

        {enableVariations && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
              <Layers className="h-3.5 w-3.5 shrink-0" />
              Количество вариантов
            </label>
            <div className="flex flex-wrap gap-2">
              {[2, 4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setVariationCount(n)}
                  className={cn(
                    "min-w-[3rem] flex-1 rounded-xl border py-2 text-sm font-semibold transition sm:flex-none sm:px-4",
                    variationCount === n
                      ? "border-violet-400 bg-violet-50 text-violet-700"
                      : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {(enableReference || enableInpaint || enableControlNet) && (
          <ImageUploadBox
            label={enableControlNet ? "Исходное изображение (для ControlNet)" : enableInpaint ? "Исходное изображение" : "Образец"}
            hint={enableControlNet ? "Форма/поза этого изображения будет перенесена в генерацию" : enableInpaint ? undefined : "Генерация будет похожа на этот образец"}
            image={referenceImage}
            uploading={refUploading}
            onSelect={handleSelectRef}
          />
        )}

        {resolvedMode === "reference" && (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-neutral-700">
              <span className="flex items-center gap-1.5 break-words">
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                Сходство с образцом
              </span>
              <span className="shrink-0 text-violet-600 font-semibold">{Math.round(strength * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="w-full max-w-full accent-violet-600"
            />
            <div className="flex flex-wrap justify-between gap-1 text-[10px] text-neutral-400">
              <span className="break-words">Больше творчества</span>
              <span className="break-words">Ближе к образцу</span>
            </div>
          </div>
        )}

        {enableInpaint && (
          <ImageUploadBox
            label="Маска (область изменения)"
            hint="Белый = изменить, чёрный = оставить"
            image={maskImage}
            uploading={maskUploading}
            onSelect={handleSelectMask}
          />
        )}

        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Стиль</label>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLE_PRESETS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(style === s.value ? "" : s.value)}
                className={cn(
                  "flex min-w-0 flex-col gap-0.5 rounded-xl border p-2.5 text-left transition break-words",
                  style === s.value
                    ? "border-violet-400 bg-violet-50"
                    : "border-neutral-200 bg-neutral-50 hover:border-neutral-300 hover:bg-white"
                )}
              >
                <span className="text-base leading-none">{s.emoji}</span>
                <span className={cn("text-xs font-semibold break-words", style === s.value ? "text-violet-700" : "text-neutral-700")}>
                  {s.label}
                </span>
                <span className="text-[10px] text-neutral-400 leading-tight break-words">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Size presets */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-700">Формат</label>
          <div className="flex flex-wrap gap-2">
            {PRESET_SIZES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSize(s)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                  size.label === s.label
                    ? "border-violet-400 bg-violet-50 text-violet-700"
                    : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-400 break-words">{size.w} × {size.h} px</p>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-700">Ошибка</p>
              <p className="mt-0.5 text-xs text-red-500 break-words">{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} className="shrink-0 text-red-400 hover:text-red-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Generate button */}
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => handleGenerate()}
          className={cn(
            "relative flex w-full max-w-full flex-wrap items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-semibold transition",
            !canGenerate
              ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
              : "bg-violet-600 text-white shadow-sm hover:bg-violet-700 active:scale-[0.98]"
          )}
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span className="break-words text-center">{STAGE_LABELS[genStage]}</span>
            </>
          ) : (
            <>
              {resolvedMode === "inpaint" ? (
                <Paintbrush className="h-4 w-4 shrink-0" />
              ) : resolvedMode === "variation" ? (
                <Layers className="h-4 w-4 shrink-0" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0" />
              )}
              <span className="break-words text-center">
                {resolvedMode === "variation" ? `Создать ${variationCount} варианта` :
                 resolvedMode === "reference" ? "По образцу" :
                 resolvedMode === "inpaint"   ? "Применить маску" :
                 "Сгенерировать"}
              </span>
              {smartMode && (
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-medium">+AI</span>
              )}
            </>
          )}
        </button>
      </div>

      {/* ══ CENTER PREVIEW ══════════════════════════════════════════════════════ */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-start gap-4 overflow-y-auto bg-neutral-50 p-6">

        {/* Generating state */}
        {generating ? (
          <div className="flex flex-col items-center gap-5 pt-8">
            <div className="relative">
              <div className="h-52 w-52 rounded-2xl border-2 border-dashed border-violet-200 bg-white" />
              <Loader2 className="absolute inset-0 m-auto h-10 w-10 animate-spin text-violet-400" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-semibold text-neutral-700">{STAGE_LABELS[genStage]}</p>
              <p className="max-w-full px-2 text-center text-xs text-neutral-400 break-words [overflow-wrap:anywhere]">
                {activeJob?.originalPrompt ?? prompt}
              </p>
              {(activeJob?.mode === "variation" || enableVariations) && (
                <p className="text-xs text-violet-500">Генерируем {variationCount} вариантов…</p>
              )}
              <div className="mt-1 flex items-center gap-2">
                {(["enhancing", "queuing", "rendering"] as const).map((s, i) => {
                    const stageOrder: GenStage[] = ["enhancing", "queuing", "rendering"];
                    const currentIdx = stageOrder.indexOf(genStage as GenStage);
                    const stepIdx = stageOrder.indexOf(s);
                    const isPast = currentIdx > stepIdx;
                    const isCurrent = genStage === s;
                    return (
                      <div key={s} className="flex items-center gap-2">
                        {i > 0 && <div className="h-px w-6 bg-neutral-200" />}
                        <div className={cn(
                          "h-2 w-2 rounded-full transition-all",
                          isCurrent ? "scale-125 bg-violet-500" :
                          isPast ? "bg-violet-300" : "bg-neutral-200"
                        )} />
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

        /* Completed — multiple images (variations) */
        ) : activeJob?.status === "completed" && isMultiResult ? (
          <div className="flex w-full flex-col gap-4">
            {lastEnhanced && (
              <EnhancedBadge
                enhanced={lastEnhanced}
                show={showEnhancedPrompt}
                onToggle={() => setShowEnhancedPrompt((v) => !v)}
              />
            )}
            <SmartFeedback applied={enhanceApplied} brain={brainResult} />
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-neutral-700">
                🎯 {resultUrls.length} вариантов
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {resultUrls.map((url, idx) => (
                <div key={url} className="group relative overflow-hidden rounded-2xl border border-neutral-200 shadow-sm">
                  <img
                    src={url}
                    alt={`Вариант ${idx + 1}`}
                    className="w-full cursor-zoom-in object-cover transition group-hover:brightness-90"
                    style={{ aspectRatio: `${activeJob.width}/${activeJob.height}` }}
                    onClick={() => setLightbox(url)}
                  />
                  <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/60 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex flex-wrap justify-center gap-2">
                      <a
                        href={url}
                        download
                        className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1.5 text-xs font-medium text-neutral-800 shadow transition hover:bg-white"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Download className="h-3 w-3" />
                        Скачать
                      </a>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteModal({ id: activeJob.id ?? activeJob.jobId, jobId: activeJob.jobId }); }}
                        className="flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-1.5 text-xs font-medium text-white shadow transition hover:bg-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                        Удалить
                      </button>
                    </div>
                  </div>
                  <span className="absolute left-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white">
                    #{idx + 1}
                  </span>
                </div>
              ))}
            </div>
            <p className="max-w-full px-2 text-center text-xs text-neutral-400 italic break-words [overflow-wrap:anywhere]">
              "{activeJob.originalPrompt ?? activeJob.prompt}"
            </p>
          </div>

        /* Completed — single image */
        ) : activeJob?.status === "completed" && activeJob.url ? (
          <div className="flex flex-col items-center gap-3">
            {lastEnhanced && (
              <EnhancedBadge
                enhanced={lastEnhanced}
                show={showEnhancedPrompt}
                onToggle={() => setShowEnhancedPrompt((v) => !v)}
              />
            )}
            <SmartFeedback applied={enhanceApplied} brain={brainResult} />
            {activeJob.mode && activeJob.mode !== "text" && (
              <div className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1">
                <span className="text-xs font-medium text-violet-700">
                  {activeJob.mode === "reference"   && "🖼 По образцу"}
                  {activeJob.mode === "inpaint"    && "✏️ Редактирование"}
                  {activeJob.mode === "controlnet" && "🧬 ControlNet"}
                </span>
              </div>
            )}
            <div className="group relative">
              <img
                src={activeJob.url}
                alt={activeJob.prompt}
                className="max-h-[480px] max-w-full cursor-zoom-in rounded-2xl border border-neutral-200 shadow-md"
                onClick={() => setLightbox(activeJob.url!)}
              />
              <div className="absolute inset-0 flex items-end justify-center rounded-2xl bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex max-w-full flex-wrap justify-center gap-2">
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
                    onClick={(e) => { e.stopPropagation(); handleRemoveBg(activeJob.url!); }}
                    className="flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-emerald-500"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    Убрать фон
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeleteModal({ id: activeJob.id ?? activeJob.jobId, jobId: activeJob.jobId, url: activeJob.url }); }}
                    className="flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Удалить
                  </button>
                </div>
              </div>
            </div>
            <p className="max-w-full px-2 text-center text-xs text-neutral-400 italic break-words [overflow-wrap:anywhere] md:max-w-md">
              "{activeJob.originalPrompt ?? activeJob.prompt}"
            </p>
          </div>

        /* Failed */
        ) : activeJob?.status === "failed" ? (
          <div className="flex flex-col items-center gap-4 pt-8">
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
          <div className="flex flex-col items-center gap-4 pt-8 text-center">
            <div className="rounded-3xl border-2 border-dashed border-neutral-200 bg-white p-14">
              <ImageIcon className="mx-auto h-14 w-14 text-neutral-200" />
            </div>
            <div className="max-w-md break-words px-2 [overflow-wrap:anywhere]">
              <p className="text-sm font-semibold text-neutral-600">
                {resolvedMode === "text"      && "Введите описание и нажмите Сгенерировать"}
                {resolvedMode === "variation" && `Введите описание — будет создано ${variationCount} вариантов`}
                {resolvedMode === "reference" && "Загрузите образец и опишите желаемый результат"}
                {resolvedMode === "inpaint"   && "Загрузите изображение и маску области изменения"}
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Можно сочетать умный режим с вариациями, образцом или маской.
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
                onOpen={() => {
                  const url = job.urls?.[0] ?? job.url;
                  if (url) setLightbox(url);
                }}
                onDelete={() => setDeleteModal({ id: job.id ?? job.jobId, jobId: job.jobId, url: job.url })}
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

      {/* ══ REMOVE BG LOADING ════════════════════════════════════════════════════ */}
      {removingBg && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/60">
          <Loader2 className="h-10 w-10 animate-spin text-white" />
          <p className="text-sm font-medium text-white">Убираем фон…</p>
          <p className="text-xs text-white/60">Обычно 10–30 секунд</p>
        </div>
      )}

      {/* ══ REMOVE BG RESULT ═════════════════════════════════════════════════════ */}
      {removeBgResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setRemoveBgResult(null)}
        >
          <div
            className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full">
              <p className="font-semibold text-neutral-900">✅ Фон удалён</p>
              <button
                type="button"
                onClick={() => setRemoveBgResult(null)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Checkerboard background to show transparency */}
            <div
              className="w-full rounded-xl overflow-hidden border border-neutral-200"
              style={{ background: "repeating-conic-gradient(#e5e7eb 0% 25%, white 0% 50%) 0 0 / 16px 16px" }}
            >
              <img
                src={removeBgResult.url}
                alt="Без фона"
                className="w-full max-h-80 object-contain"
              />
            </div>
            <div className="flex w-full gap-3">
              <a
                href={removeBgResult.url}
                download
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                <Download className="h-4 w-4" />
                Скачать PNG
              </a>
              <button
                type="button"
                onClick={() => setRemoveBgResult(null)}
                className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
              >
                Закрыть
              </button>
            </div>
          </div>
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
                  onClick={() => handleDelete(deleteModal.id, deleteModal.jobId)}
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

// ── Client-side brain (mirrors server aiBrain.js) ────────────────────────────

const CLIENT_TYPE_RULES: Array<{ type: string; keywords: string[] }> = [
  { type: "character",    keywords: ["человек","woman","man","girl","boy","женщина","мужчина","девушка","парень","warrior","hero","персонаж","character","portrait","портрет","лицо","face","person","люди","people","princess","queen","king","ninja","samurai","astronaut"] },
  { type: "animal",       keywords: ["cat","dog","кот","собака","кошка","животное","animal","wolf","волк","fox","лиса","bear","медведь","lion","тигр","tiger","bird","птица","horse","лошадь","dragon","дракон","creature","rabbit","кролик","deer","олень","fish","рыба"] },
  { type: "landscape",    keywords: ["landscape","пейзаж","mountain","гора","forest","лес","ocean","море","sea","lake","озеро","river","река","desert","пустыня","sky","небо","sunset","закат","sunrise","рассвет","nature","природа","field","поле","valley","canyon","waterfall","beach","пляж","island","остров","snow","снег","jungle","cave"] },
  { type: "architecture", keywords: ["building","здание","house","дом","castle","замок","tower","башня","bridge","мост","cathedral","church","храм","city","город","street","улица","interior","интерьер","room","комната","architecture","архитектура","palace","дворец","ruins","ruинs","skyscraper","temple","alley"] },
  { type: "product",      keywords: ["product","товар","bottle","бутылка","box","коробка","package","упаковка","label","этикетка","perfume","духи","phone","телефон","laptop","ноутбук","watch","часы","shoes","обувь","bag","сумка","car","машина","jewelry","ring","кольцо","cup","кружка"] },
  { type: "food",         keywords: ["food","еда","dish","блюдо","meal","ужин","завтрак","обед","breakfast","lunch","dinner","pizza","burger","sushi","cake","торт","coffee","кофе","tea","чай","fruit","фрукт","vegetable","овощ","bread","хлеб","pasta","soup","суп","salad","салат","dessert","cocktail","wine","вино"] },
  { type: "abstract",     keywords: ["abstract","абстракция","pattern","узор","texture","текстура","fractal","digital art","geometry","геометрия","mandala","neon","неон","glitch","space","cosmos","космос","nebula","galaxy","energy","энергия","flow","light","свет"] },
];

function clientDetectType(prompt: string): string {
  const lower = prompt.toLowerCase();
  let best = { type: "unknown", score: 0 };
  for (const r of CLIENT_TYPE_RULES) {
    const score = r.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > best.score) best = { type: r.type, score };
  }
  return best.type;
}

function PromptBrainChip({ prompt }: { prompt: string }) {
  const type = clientDetectType(prompt);
  if (type === "unknown") return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-violet-500">
      <span className="font-medium">🧠</span>
      <span>AI Brain: определён как <span className="font-semibold">{TYPE_LABEL[type]}</span></span>
    </div>
  );
}

// ── Smart mode feedback ───────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  character:    "🧑 персонаж",
  animal:       "🐾 животное",
  landscape:    "🌄 пейзаж",
  architecture: "🏛 архитектура",
  product:      "📦 продукт",
  food:         "🍽 еда",
  abstract:     "🌀 абстракция",
  unknown:      "🧠 общий",
};

function SmartFeedback({
  applied,
  brain,
}: {
  applied: EnhanceApplied | null;
  brain: BrainResult | null;
}) {
  if (!applied && !brain) return null;

  const items: { label: string; sub?: string }[] = [];
  if (brain?.type) items.push({ label: TYPE_LABEL[brain.type] ?? brain.type });
  if (applied?.style || brain?.style) items.push({ label: `стиль: ${applied?.style ?? brain?.style}` });
  if (applied?.aspectRatio) items.push({ label: `формат: ${applied.aspectRatio}` });
  if (applied?.systemPrompt) items.push({ label: "системный промпт" });
  if (!items.length) return null;

  return (
    <div className="flex w-full max-w-lg flex-col gap-1.5 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2.5">
      <span className="text-xs font-semibold text-violet-700">✨ Умный режим применил:</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span key={i} className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-violet-600 break-words">
            {item.label}
          </span>
        ))}
      </div>
      {brain?.composition && (
        <p className="text-[10px] text-violet-400 break-words leading-relaxed">
          📐 {brain.composition}
        </p>
      )}
    </div>
  );
}

// ── Enhanced prompt badge ─────────────────────────────────────────────────────

function EnhancedBadge({
  enhanced,
  show,
  onToggle,
}: {
  enhanced: { prompt: string; negative: string };
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full max-w-lg flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
        <span className="text-xs font-medium text-amber-700">✨ Промпт улучшен автоматически</span>
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-amber-800"
        >
          <Eye className="h-3 w-3" />
          {show ? "Скрыть" : "Показать"}
        </button>
      </div>
      {show && (
        <div className="rounded-xl border border-amber-200 bg-white p-3">
          <p className="text-[11px] font-medium text-neutral-500 mb-1">Улучшенный промпт:</p>
          <p className="text-xs text-neutral-700 leading-relaxed break-words [overflow-wrap:anywhere]">{enhanced.prompt}</p>
        </div>
      )}
    </div>
  );
}

// ── History card ──────────────────────────────────────────────────────────────

const MODE_ICON: Record<string, string> = {
  text:       "🧠",
  variation:  "🎯",
  reference:  "🖼",
  inpaint:    "✏️",
  controlnet: "🧬",
};

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
  const thumbUrl = job.urls?.[0] ?? job.url;
  const isMulti = (job.urls?.length ?? 0) > 1;

  return (
    <div className="group relative flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-2 transition hover:border-neutral-300 hover:bg-white">
      {thumbUrl ? (
        <div className="relative cursor-pointer overflow-hidden rounded-lg" onClick={onOpen}>
          <img
            src={thumbUrl}
            alt={job.prompt}
            className="w-full object-cover transition group-hover:brightness-95"
            style={{ aspectRatio: `${job.width}/${job.height}`, maxHeight: 110 }}
          />
          {isMulti && (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">
              ×{job.urls!.length}
            </span>
          )}
          <div className="absolute inset-0 flex flex-wrap items-center justify-center gap-2 bg-black/40 px-1 opacity-0 transition-opacity group-hover:opacity-100">
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
        <div className="flex items-center gap-1">
          {job.mode && <span className="text-[11px]">{MODE_ICON[job.mode] ?? "🧠"}</span>}
          <StatusBadge status={job.status} />
        </div>
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
      <p className="line-clamp-2 text-[11px] leading-snug text-neutral-500 break-words [overflow-wrap:anywhere]">
        {job.originalPrompt ?? job.prompt}
      </p>
    </div>
  );
}

