/**
 * ImageStudioPage — полный рерайт UI (Midjourney / Runway / Leonardo AI level)
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Loader2, Download, Trash2, RotateCcw, Eye,
  ChevronDown, ChevronUp, Upload, X, Scissors, Settings2,
  ImageIcon, ZoomIn, Clock,
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";

console.log("NEW UI LOADED");

const API = import.meta.env.VITE_API_URL ?? "/api";

// ── Types ────────────────────────────────────────────────────────────────────

type QuickOption = "variations" | "reference" | "inpaint" | "controlnet" | "removeBg";

interface ImageJob {
  id?: string;
  jobId: string;
  status: "queued" | "waiting" | "active" | "completed" | "failed";
  mode?: string;
  prompt: string;
  originalPrompt?: string;
  style?: string;
  width: number;
  height: number;
  url?: string;
  urls?: string[];
  dbIds?: string[];
  count?: number;
  error?: string;
  createdAt: string;
}

interface EnhanceInfo {
  enhancedPrompt: string;
  negativePrompt?: string;
  style?: string | null;
  aspectRatio?: string | null;
  brain?: { type: string; typeLabel: string; style: string; composition: string; suggestedMode: string } | null;
}

interface RefImage {
  previewUrl: string;
  refUrl: string;
}

type GenStage = "idle" | "enhancing" | "queuing" | "rendering" | "done";

// ── Constants ────────────────────────────────────────────────────────────────

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

const STYLE_CARDS = [
  { value: "cinematic",  label: "Cinematic",  desc: "Киношный свет",    emoji: "🎬" },
  { value: "pixar",      label: "Pixar 3D",   desc: "Мультяшный 3D",    emoji: "🎨" },
  { value: "realistic",  label: "Realistic",  desc: "Фотореализм",      emoji: "📷" },
  { value: "anime",      label: "Anime",      desc: "Аниме стиль",      emoji: "⛩️" },
  { value: "watercolor", label: "Watercolor", desc: "Акварель",          emoji: "🖌️" },
  { value: "3d-render",  label: "3D Render",  desc: "3D рендеринг",     emoji: "💎" },
];

const QUICK_OPTIONS: { id: QuickOption; label: string; emoji: string; desc: string }[] = [
  { id: "variations",  label: "Вариации",   emoji: "🎯", desc: "Несколько версий" },
  { id: "reference",   label: "По образцу", emoji: "🖼",  desc: "Изображение-основа" },
  { id: "inpaint",     label: "Редактирование", emoji: "✏️", desc: "Изменить область" },
  { id: "controlnet",  label: "ControlNet", emoji: "🧬", desc: "Контроль формы/позы" },
  { id: "removeBg",    label: "Убрать фон", emoji: "✂️", desc: "Прозрачный PNG" },
];

const PRESET_SIZES = [
  { label: "1:1",  w: 1024, h: 1024 },
  { label: "16:9", w: 1344, h: 768  },
  { label: "9:16", w: 768,  h: 1344 },
  { label: "4:3",  w: 1024, h: 768  },
];

// ── Client-side Brain (mirrors aiBrainV2.js — zero latency) ──────────────────

const CLIENT_TYPE_RULES: { type: string; label: string; style: string; keywords: string[] }[] = [
  { type: "character", label: "Персонаж",   style: "cinematic portrait",
    keywords: ["человек","woman","man","girl","boy","женщина","мужчина","девушка","парень","ребёнок","child","warrior","soldier","knight","wizard","hero","герой","персонаж","character","portrait","портрет","лицо","face","person","люди","people","princess","queen","king","witch","elf","ninja","samurai","astronaut"] },
  { type: "animal",    label: "Животное",   style: "wildlife photography",
    keywords: ["cat","dog","кот","собака","кошка","animal","wolf","волк","fox","лиса","bear","медведь","lion","тигр","tiger","bird","птица","horse","лошадь","dragon","дракон","rabbit","кролик","deer","fish","panda","панда"] },
  { type: "landscape", label: "Пейзаж",     style: "epic landscape, golden hour",
    keywords: ["landscape","пейзаж","mountain","гора","горы","forest","лес","ocean","море","sea","lake","озеро","river","река","desert","пустыня","sky","небо","sunset","закат","sunrise","рассвет","nature","природа","field","поле","valley","waterfall","beach","пляж","island","остров","snow","снег","jungle","cave","cliff","скала"] },
  { type: "architecture", label: "Архитектура", style: "architectural photography",
    keywords: ["building","здание","house","дом","castle","замок","tower","башня","bridge","мост","cathedral","church","храм","city","город","street","улица","interior","интерьер","architecture","архитектура","palace","дворец","ruins","ruins","skyscraper","небоскрёб","temple"] },
  { type: "product",   label: "Продукт",    style: "studio product photography",
    keywords: ["product","товар","bottle","бутылка","box","коробка","package","упаковка","perfume","духи","phone","телефон","айфон","iphone","laptop","ноутбук","watch","часы","shoes","обувь","bag","сумка","car","машина","gadget","device","устройство","jewelry","ring","кольцо","cup","кружка"] },
  { type: "food",      label: "Еда",        style: "food photography",
    keywords: ["food","еда","dish","блюдо","meal","pizza","пицца","burger","бургер","sushi","суши","cake","торт","coffee","кофе","tea","чай","fruit","фрукт","bread","хлеб","soup","суп","salad","салат","dessert","десерт","cocktail","wine","вино"] },
  { type: "abstract",  label: "Абстракция", style: "digital art, vivid colors",
    keywords: ["abstract","абстракция","pattern","узор","texture","текстура","fractal","фрактал","digital art","geometry","геометрия","mandala","мандала","neon","неон","space","cosmos","космос","nebula","galaxy","галактика"] },
];

function clientDetectBrain(text: string): { type: string; label: string; style: string } | null {
  if (!text || text.trim().length < 3) return null;
  const lower = text.toLowerCase();
  let best = { type: "unknown", label: "", style: "", score: 0 };
  for (const rule of CLIENT_TYPE_RULES) {
    let score = 0;
    for (const kw of rule.keywords) { if (lower.includes(kw)) score++; }
    if (score > best.score) best = { ...rule, score };
  }
  return best.score > 0 ? best : null;
}

const STAGE_STEPS: { stage: GenStage; label: string }[] = [
  { stage: "enhancing", label: "Улучшение промпта" },
  { stage: "queuing",   label: "Отправка в очередь" },
  { stage: "rendering", label: "Рендеринг" },
];

const MODE_ICON: Record<string, string> = {
  text: "🧠", variation: "🎯", reference: "🖼", inpaint: "✏️", controlnet: "🧬",
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Live AI Brain chip shown under textarea while user types */
function BrainChip({ prompt, smartMode }: { prompt: string; smartMode: boolean }) {
  if (!smartMode) return null;
  const brain = clientDetectBrain(prompt);
  if (!brain) return null;

  const TYPE_EMOJI: Record<string, string> = {
    character: "🧑", animal: "🐾", landscape: "🌄", architecture: "🏛",
    product: "📦", food: "🍕", abstract: "✨",
  };

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-[11px] text-violet-400">
      <span className="text-sm">{TYPE_EMOJI[brain.type] ?? "🧠"}</span>
      <span>
        <span className="font-medium">AI Brain:</span> {brain.label} ·{" "}
        <span className="opacity-70">{brain.style}</span>
      </span>
    </div>
  );
}

function ProgressBar({ stage }: { stage: GenStage }) {
  const stepIndex = STAGE_STEPS.findIndex((s) => s.stage === stage);
  const total = STAGE_STEPS.length;
  const pct = stepIndex < 0 ? 0 : ((stepIndex + 1) / total) * 100;

  return (
    <div className="w-full max-w-sm">
      <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
        <span>{STAGE_STEPS[Math.max(0, stepIndex)]?.label ?? "Обработка…"}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-4 flex justify-center gap-6">
        {STAGE_STEPS.map((s, i) => (
          <div key={s.stage} className="flex flex-col items-center gap-1">
            <div className={cn(
              "h-2 w-2 rounded-full transition-colors",
              i <= stepIndex ? "bg-violet-500" : "bg-neutral-200"
            )} />
            <span className={cn(
              "text-[10px]",
              i <= stepIndex ? "text-violet-600 font-medium" : "text-neutral-400"
            )}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryCard({
  job,
  active,
  onClick,
  onReuse,
  onDelete,
}: {
  job: ImageJob;
  active: boolean;
  onClick: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  const thumb = job.url ?? job.urls?.[0];
  const count = job.urls?.length ?? (job.count ?? 1);
  const statusColor = {
    queued: "bg-neutral-200", waiting: "bg-neutral-200",
    active: "bg-blue-400 animate-pulse",
    completed: "bg-emerald-400", failed: "bg-red-400",
  }[job.status] ?? "bg-neutral-200";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex w-full gap-2.5 rounded-xl border p-2 text-left transition",
        active
          ? "border-violet-300 bg-violet-50"
          : "border-transparent bg-neutral-50 hover:border-neutral-200 hover:bg-white"
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-neutral-100">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-4 w-4 text-neutral-300" />
          </div>
        )}
        {count > 1 && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 text-[9px] font-bold text-white">
            ×{count}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", statusColor)} />
          <span className="truncate text-[11px] text-neutral-500">
            {MODE_ICON[job.mode ?? "text"]} {job.status === "failed" ? "Ошибка" : job.status === "active" ? "Генерация…" : job.status === "completed" ? "Готово" : "В очереди"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs font-medium text-neutral-700">
          {job.originalPrompt ?? job.prompt}
        </p>
        <p className="mt-0.5 text-[10px] text-neutral-400">
          {new Date(job.createdAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>

      {/* Hover actions */}
      <div className="absolute inset-y-0 right-1 hidden items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          title="Повторить"
          onClick={(e) => { e.stopPropagation(); onReuse(); }}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Удалить"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-500"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </button>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ImageStudioPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const headers = { Authorization: `Bearer ${accessToken ?? ""}`, "Content-Type": "application/json" };

  // Prompt & style
  const [prompt, setPrompt]   = useState("");
  const [style, setStyle]     = useState("");
  const [size, setSize]       = useState(PRESET_SIZES[0]);
  const [negPrompt, setNegPrompt] = useState("");
  const [steps, setSteps]     = useState(30);
  const [cfg, setCfg]         = useState(7);
  const [seed, setSeed]       = useState("");

  // Smart mode
  const [smartMode, setSmartMode]   = useState(true);
  const [enhanceInfo, setEnhanceInfo] = useState<EnhanceInfo | null>(null);
  const [showEnhanced, setShowEnhanced] = useState(false);

  // Quick options
  const [activeOptions, setActiveOptions] = useState<Set<QuickOption>>(new Set());
  const [variationCount, setVariationCount] = useState(4);
  const [controlType, setControlType] = useState<"canny" | "pose">("canny");
  const [strength, setStrength] = useState(0.5);

  // Reference image
  const [refImage, setRefImage]     = useState<RefImage | null>(null);
  const [maskImage, setMaskImage]   = useState<RefImage | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [maskUploading, setMaskUploading] = useState(false);

  // Generation
  const [genStage, setGenStage]     = useState<GenStage>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob]   = useState<ImageJob | null>(null);
  const generating = genStage !== "idle" && genStage !== "done";

  // UI
  const [history, setHistory]           = useState<ImageJob[]>([]);
  const [histLoading, setHistLoading]   = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [lightbox, setLightbox]         = useState<string | null>(null);
  const [deleteModal, setDeleteModal]   = useState<{ id: string; jobId: string } | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Remove bg result
  const [removingBg, setRemovingBg]         = useState(false);
  const [removeBgResult, setRemoveBgResult] = useState<{ url: string } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refInputRef  = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => { loadHistory(); }, []);

  useEffect(() => {
    if (!activeJobId) return;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollJob(activeJobId), 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeJobId]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const toggleOption = useCallback((opt: QuickOption) => {
    setActiveOptions((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      // Mutex: only one image-source option at a time for reference/inpaint/controlnet
      if (opt !== "removeBg" && opt !== "variations") {
        for (const o of ["reference", "inpaint", "controlnet"] as QuickOption[]) {
          if (o !== opt) next.delete(o);
        }
      }
      return next;
    });
  }, []);

  function resolveMode(): string {
    if (activeOptions.has("variations"))  return "variation";
    if (activeOptions.has("controlnet") && refImage) return "controlnet";
    if (activeOptions.has("inpaint") && refImage && maskImage) return "inpaint";
    if (activeOptions.has("reference") && refImage) return "reference";
    return "text";
  }

  // ── API ──────────────────────────────────────────────────────────────────────

  async function loadHistory() {
    setHistLoading(true);
    try {
      const res = await fetch(`${API}/image/list`, { headers });
      if (res.ok) {
        const data = await res.json() as { items: ImageJob[] };
        setHistory(data.items ?? []);
      }
    } finally {
      setHistLoading(false);
    }
  }

  async function pollJob(jobId: string) {
    try {
      const res = await fetch(`${API}/image/status/${jobId}`, { headers });
      if (!res.ok) return;
      const job = await res.json() as ImageJob;
      if (job.dbIds?.length) job.id = job.dbIds[0];
      setActiveJob(job);
      if (job.status === "active") setGenStage("rendering");
      if (job.status === "completed" || job.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setGenStage("done");
        setActiveJobId(null);
        loadHistory();

        // Auto remove-bg
        if (job.status === "completed" && activeOptions.has("removeBg") && job.url) {
          doRemoveBg(job.url);
        }
      }
    } catch { /* ignore */ }
  }

  async function uploadRefFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/image/upload-ref`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      body: fd,
    });
    if (!res.ok) throw new Error("Ошибка загрузки файла");
    const d = await res.json() as { refUrl: string };
    return d.refUrl;
  }

  async function handleSelectRef(file: File) {
    setRefUploading(true);
    try {
      const refUrl  = await uploadRefFile(file);
      setRefImage({ previewUrl: URL.createObjectURL(file), refUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки изображения");
    } finally { setRefUploading(false); }
  }

  async function handleSelectMask(file: File) {
    setMaskUploading(true);
    try {
      const refUrl = await uploadRefFile(file);
      setMaskImage({ previewUrl: URL.createObjectURL(file), refUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки маски");
    } finally { setMaskUploading(false); }
  }

  async function doRemoveBg(imageUrl: string) {
    setRemovingBg(true);
    setRemoveBgResult(null);
    try {
      const res = await fetch(`${API}/image/remove-bg`, {
        method: "POST",
        headers,
        body: JSON.stringify({ imageUrl }),
      });
      const d = await res.json() as { url?: string; error?: string };
      if (res.ok && d.url) setRemoveBgResult({ url: d.url });
      else setError(d.error ?? "Не удалось убрать фон");
    } catch {
      setError("Ошибка удаления фона");
    } finally { setRemovingBg(false); }
  }

  // ── Generate ─────────────────────────────────────────────────────────────────

  async function handleGenerate(overridePrompt?: string) {
    const raw = (overridePrompt ?? prompt).trim();
    if (!raw || generating) return;

    setError(null);
    setEnhanceInfo(null);
    setShowEnhanced(false);
    setActiveJob(null);
    setRemoveBgResult(null);

    const mode = resolveMode();

    try {
      let finalPrompt = raw;
      let finalNeg    = negPrompt || undefined;

      // 1. Enhance
      if (smartMode) {
        setGenStage("enhancing");
        const res = await fetch(`${API}/image/enhance`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: raw,
            style: style || undefined,
            aspectRatio: `${size.w}:${size.h}`,
          }),
        });
        if (res.ok) {
          const d = await res.json() as {
            enhancedPrompt?: string;
            negativePrompt?: string;
            appliedStyle?: string | null;
            appliedAspectRatio?: string | null;
            brain?: { type: string; style: string; composition: string } | null;
          };
          if (d.enhancedPrompt) {
            finalPrompt = d.enhancedPrompt;
            finalNeg    = d.negativePrompt ?? finalNeg;
            setEnhanceInfo({
              enhancedPrompt: d.enhancedPrompt,
              negativePrompt: d.negativePrompt,
              style: d.appliedStyle,
              aspectRatio: d.appliedAspectRatio,
              brain: d.brain,
            });
          }
        }
      }

      // 2. Queue
      setGenStage("queuing");
      const body: Record<string, unknown> = {
        prompt:       finalPrompt,
        width:        size.w,
        height:       size.h,
        mode,
        smartMode,
        variations:   activeOptions.has("variations") ? variationCount : 1,
        aspectRatio:  `${size.w}:${size.h}`,
        steps,
        cfgScale:     cfg,
        ...(seed ? { seed: Number(seed) } : {}),
      };
      if (finalNeg)  body.negativePrompt = finalNeg;
      if (style)     body.style = style;
      if (mode === "controlnet") body.controlType = controlType;
      if (mode === "reference" || mode === "inpaint") {
        body.referenceImageUrl = refImage?.refUrl;
        body.strength = strength;
      }
      if (mode === "inpaint") body.maskUrl = maskImage?.refUrl;

      const res  = await fetch(`${API}/image/generate`, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json() as { jobId?: string; error?: string };

      if (!res.ok) {
        setError("Ошибка генерации. Попробуйте изменить описание.");
        setGenStage("idle");
        return;
      }

      setGenStage("rendering");
      setActiveJobId(data.jobId!);
      setActiveJob({
        jobId:         data.jobId!,
        status:        "queued",
        mode,
        prompt:        finalPrompt,
        originalPrompt: raw,
        width:         size.w,
        height:        size.h,
        createdAt:     new Date().toISOString(),
      });
    } catch {
      setError("Ошибка сети. Проверьте соединение.");
      setGenStage("idle");
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, jobId: string) {
    setDeleting(true);
    const delId = id || jobId;
    try {
      const res = await fetch(`${API}/image/${delId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      });
      if (res.ok || res.status === 404) {
        setHistory((prev) => prev.filter((j) => (j.id ?? j.jobId) !== delId));
        if (activeJob?.id === delId || activeJob?.jobId === delId) {
          setActiveJob(null);
          setGenStage("idle");
        }
        if (lightbox) setLightbox(null);
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
      setDeleteModal(null);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────────

  const images: string[] = activeJob?.urls?.length
    ? activeJob.urls
    : activeJob?.url
      ? [activeJob.url]
      : [];

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-white/5 px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500">
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">Image Studio</span>
        </div>
        <Link
          to="/image-studio/settings"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-white"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Настройки
        </Link>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* ════ LEFT PANEL ═══════════════════════════════════════════════════ */}
        <aside className="flex w-[320px] flex-shrink-0 flex-col gap-0 overflow-y-auto border-r border-white/5 bg-neutral-900">
          <div className="flex flex-col gap-4 p-4">

            {/* 1. Prompt */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-300">Промпт</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                placeholder="Опиши изображение..."
                rows={4}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 [overflow-wrap:anywhere]"
              />
              {/* Live Brain chip */}
              <BrainChip prompt={prompt} smartMode={smartMode} />

              {/* Smart feedback */}
              {enhanceInfo && showEnhanced && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs text-violet-300">
                  <p className="font-medium mb-1">✨ Улучшенный промпт:</p>
                  <p className="text-neutral-300 leading-relaxed">{enhanceInfo.enhancedPrompt}</p>
                  {enhanceInfo.brain && (
                    <p className="mt-1.5 text-violet-400 opacity-70">
                      🧠 Определено: {enhanceInfo.brain.typeLabel ?? enhanceInfo.brain.type} · {enhanceInfo.brain.style}
                    </p>
                  )}
                </div>
              )}
              {enhanceInfo && !showEnhanced && (
                <button
                  type="button"
                  onClick={() => setShowEnhanced(true)}
                  className="flex items-center gap-1.5 self-start rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-400 hover:bg-violet-500/20"
                >
                  <Sparkles className="h-3 w-3" />
                  Промпт улучшен
                  <Eye className="h-3 w-3" />
                  показать
                </button>
              )}
            </div>

            {/* 2. Smart Mode */}
            <div className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">🧠 Умный режим</p>
                <p className="mt-0.5 text-[11px] text-neutral-500 leading-relaxed">
                  AI улучшает и настраивает генерацию
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSmartMode((p) => !p)}
                className={cn(
                  "relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full border transition-colors",
                  smartMode ? "border-violet-500 bg-violet-500" : "border-white/10 bg-white/5"
                )}
              >
                <span className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                  smartMode ? "left-5" : "left-0.5"
                )} />
              </button>
            </div>

            {/* 3. Quick Options */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-400">Опции</label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_OPTIONS.map((opt) => {
                  const active = activeOptions.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => toggleOption(opt.id)}
                      title={opt.desc}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                        active
                          ? "border-violet-500/50 bg-violet-500/20 text-violet-300"
                          : "border-white/10 bg-white/5 text-neutral-400 hover:border-white/20 hover:text-neutral-200"
                      )}
                    >
                      <span>{opt.emoji}</span>
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Conditional sub-options */}
              {activeOptions.has("variations") && (
                <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                  <span className="text-xs text-neutral-400">Вариантов:</span>
                  {[2, 4, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setVariationCount(n)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                        variationCount === n
                          ? "bg-violet-500 text-white"
                          : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}

              {(activeOptions.has("reference") || activeOptions.has("inpaint") || activeOptions.has("controlnet")) && (
                <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                  <p className="mb-2 text-[11px] font-medium text-neutral-400">
                    {activeOptions.has("controlnet") ? "🧬 Изображение для ControlNet" : "🖼 Изображение-основа"}
                  </p>
                  <button
                    type="button"
                    onClick={() => refInputRef.current?.click()}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-xs transition",
                      refImage
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                        : "border-white/10 text-neutral-500 hover:border-violet-500/30 hover:text-neutral-300"
                    )}
                  >
                    {refUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : refImage ? (
                      <img src={refImage.previewUrl} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <><Upload className="h-4 w-4" /> Загрузить изображение</>
                    )}
                  </button>
                  <input ref={refInputRef} type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSelectRef(f); e.target.value = ""; }}
                  />

                  {activeOptions.has("reference") && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                        <span>Сходство</span><span>{Math.round(strength * 100)}%</span>
                      </div>
                      <input type="range" min="0.2" max="0.8" step="0.05" value={strength}
                        onChange={(e) => setStrength(Number(e.target.value))}
                        className="w-full accent-violet-500"
                      />
                    </div>
                  )}

                  {activeOptions.has("controlnet") && (
                    <div className="mt-2 flex gap-2">
                      {(["canny", "pose"] as const).map((t) => (
                        <button key={t} type="button" onClick={() => setControlType(t)}
                          className={cn(
                            "flex-1 rounded-lg py-1 text-xs font-medium transition",
                            controlType === t ? "bg-violet-500 text-white" : "bg-white/5 text-neutral-400 hover:bg-white/10"
                          )}
                        >
                          {t === "canny" ? "Контур" : "Поза"}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeOptions.has("inpaint") && refImage && (
                    <div className="mt-2">
                      <p className="mb-2 text-[11px] font-medium text-neutral-400">✏️ Маска (область изменения)</p>
                      <button type="button" onClick={() => maskInputRef.current?.click()}
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-2 text-xs transition",
                          maskImage ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-white/10 text-neutral-500 hover:border-amber-500/30"
                        )}
                      >
                        {maskUploading ? <Loader2 className="h-4 w-4 animate-spin" />
                          : maskImage ? <img src={maskImage.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
                          : <><Upload className="h-4 w-4" /> Загрузить маску</>}
                      </button>
                      <input ref={maskInputRef} type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSelectMask(f); e.target.value = ""; }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. Style */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-400">Стиль</label>
              <div className="grid grid-cols-3 gap-1.5">
                {STYLE_CARDS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setStyle(style === s.value ? "" : s.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl border py-2.5 text-center transition",
                      style === s.value
                        ? "border-violet-500/50 bg-violet-500/20"
                        : "border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/5"
                    )}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    <span className={cn("text-[11px] font-medium leading-tight", style === s.value ? "text-violet-300" : "text-neutral-300")}>
                      {s.label}
                    </span>
                    <span className="text-[9px] text-neutral-500 leading-tight">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 4b. Size */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-400">Размер</label>
              <div className="flex gap-1.5">
                {PRESET_SIZES.map((p) => (
                  <button key={p.label} type="button" onClick={() => setSize(p)}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-xs font-medium transition",
                      size.label === p.label
                        ? "bg-violet-500 text-white"
                        : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 5. Advanced */}
            <div className="rounded-xl border border-white/5 bg-white/[0.03]">
              <button
                type="button"
                onClick={() => setShowAdvanced((p) => !p)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium text-neutral-400 hover:text-neutral-200"
              >
                <span>▼ Расширенные настройки</span>
                {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showAdvanced && (
                <div className="flex flex-col gap-3 border-t border-white/5 px-3 pb-3 pt-3">
                  <AdvancedField label="Шаги" hint="20–50">
                    <input type="number" min={10} max={100} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500"
                    />
                  </AdvancedField>
                  <AdvancedField label="CFG Scale" hint="1–20">
                    <input type="number" min={1} max={20} value={cfg} onChange={(e) => setCfg(Number(e.target.value))}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white outline-none focus:border-violet-500"
                    />
                  </AdvancedField>
                  <AdvancedField label="Seed" hint="пусто = случайный">
                    <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)}
                      placeholder="случайный"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 outline-none focus:border-violet-500"
                    />
                  </AdvancedField>
                  <AdvancedField label="Negative Prompt" hint="">
                    <textarea value={negPrompt} onChange={(e) => setNegPrompt(e.target.value)}
                      rows={2} placeholder="Что НЕ рисовать..."
                      className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-neutral-600 outline-none focus:border-violet-500"
                    />
                  </AdvancedField>
                </div>
              )}
            </div>

            {/* 6. Generate Button */}
            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={!prompt.trim() || generating}
              className={cn(
                "relative flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition",
                !prompt.trim() || generating
                  ? "cursor-not-allowed bg-white/5 text-neutral-500"
                  : "bg-violet-500 text-white shadow-lg shadow-violet-500/20 hover:bg-violet-400 active:scale-[0.99]"
              )}
            >
              {generating ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Генерация…</>
              ) : (
                <><Sparkles className="h-4 w-4" /> Сгенерировать</>
              )}
              {smartMode && !generating && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white/90">
                  +AI
                </span>
              )}
            </button>

          </div>
        </aside>

        {/* ════ CENTER — PREVIEW ═════════════════════════════════════════════ */}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-neutral-950 p-6">

          {/* Error */}
          {error && (
            <div className="mb-4 flex w-full max-w-xl items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5">
              <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-red-400">❌ Ошибка генерации</p>
                <p className="mt-0.5 text-xs text-red-400/70">Попробуйте изменить описание</p>
              </div>
              <button type="button" onClick={() => setError(null)} className="ml-auto text-red-400/50 hover:text-red-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Empty state */}
          {genStage === "idle" && !activeJob && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5">
                <Sparkles className="h-10 w-10 text-violet-400 opacity-60" />
              </div>
              <div>
                <p className="text-base font-medium text-neutral-300">Опиши изображение</p>
                <p className="mt-1 text-sm text-neutral-600">и нажми Сгенерировать</p>
              </div>
              <p className="text-xs text-neutral-700">Ctrl+Enter для быстрого запуска</p>
            </div>
          )}

          {/* Progress */}
          {generating && (
            <ProgressBar stage={genStage} />
          )}

          {/* Result — single image */}
          {genStage === "done" && activeJob?.status === "completed" && images.length === 1 && (
            <div className="group relative max-w-xl w-full">
              <img
                src={images[0]}
                alt={activeJob.prompt}
                className="w-full rounded-2xl shadow-2xl shadow-black/60 cursor-zoom-in"
                onClick={() => setLightbox(images[0])}
              />
              {/* Overlay */}
              <div className="absolute inset-0 flex flex-col items-end justify-start gap-2 rounded-2xl bg-black/0 p-3 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                <div className="flex gap-2">
                  <OverlayBtn icon={<Download className="h-4 w-4" />} label="Скачать" href={images[0]} download />
                  <OverlayBtn icon={<RotateCcw className="h-4 w-4" />} label="Повторить" onClick={() => handleGenerate(activeJob.originalPrompt ?? activeJob.prompt)} />
                  <OverlayBtn icon={<Scissors className="h-4 w-4" />} label="Убрать фон" onClick={() => doRemoveBg(images[0])} />
                  <OverlayBtn icon={<Trash2 className="h-4 w-4" />} label="Удалить" danger onClick={() => setDeleteModal({ id: activeJob.id ?? activeJob.jobId, jobId: activeJob.jobId })} />
                </div>
              </div>
            </div>
          )}

          {/* Result — variations grid */}
          {genStage === "done" && activeJob?.status === "completed" && images.length > 1 && (
            <div className={cn(
              "grid w-full max-w-2xl gap-3",
              images.length === 2 ? "grid-cols-2" : "grid-cols-2"
            )}>
              {images.map((url, i) => (
                <div key={url} className="group relative aspect-square overflow-hidden rounded-xl">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-end justify-end gap-1.5 bg-black/0 p-2 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                    <OverlayBtn icon={<ZoomIn className="h-3.5 w-3.5" />} label="Открыть" onClick={() => setLightbox(url)} />
                    <OverlayBtn icon={<Download className="h-3.5 w-3.5" />} label="Скачать" href={url} download />
                    <OverlayBtn icon={<Scissors className="h-3.5 w-3.5" />} label="Убрать фон" onClick={() => doRemoveBg(url)} />
                  </div>
                  <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    #{i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Failed */}
          {genStage === "done" && activeJob?.status === "failed" && (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10">
                <X className="h-8 w-8 text-red-400" />
              </div>
              <p className="font-medium text-red-400">❌ Ошибка генерации</p>
              <p className="text-sm text-neutral-500">Попробуйте изменить описание</p>
              <button type="button" onClick={() => { setActiveJob(null); setGenStage("idle"); setError(null); }}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm text-neutral-300 hover:bg-white/10">
                Попробовать снова
              </button>
            </div>
          )}

          {/* Remove bg loader */}
          {removingBg && (
            <div className="mt-6 flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-neutral-300">
              <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              Убираем фон…
            </div>
          )}

          {/* Remove bg result */}
          {removeBgResult && (
            <div className="mt-6 flex flex-col items-center gap-3">
              <p className="text-xs font-medium text-emerald-400">✅ Фон удалён</p>
              <div
                className="overflow-hidden rounded-xl border border-white/10"
                style={{ background: "repeating-conic-gradient(#1a1a1a 0% 25%, #111 0% 50%) 0 0 / 16px 16px" }}
              >
                <img src={removeBgResult.url} alt="no-bg" className="max-h-60 object-contain" />
              </div>
              <a href={removeBgResult.url} download
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/30">
                <Download className="h-3.5 w-3.5" />
                Скачать PNG
              </a>
            </div>
          )}

        </main>

        {/* ════ RIGHT — HISTORY ══════════════════════════════════════════════ */}
        <aside className="flex w-[280px] flex-shrink-0 flex-col border-l border-white/5 bg-neutral-900">
          <div className="flex items-center justify-between border-b border-white/5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-400">
              <Clock className="h-3.5 w-3.5" />
              История
            </div>
            <button type="button" onClick={loadHistory}
              className="rounded-lg p-1 text-neutral-600 hover:bg-white/5 hover:text-neutral-300">
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {histLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-600" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ImageIcon className="h-8 w-8 text-neutral-700" />
                <p className="text-xs text-neutral-600">История пуста</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {history.map((job) => (
                  <HistoryCard
                    key={job.id ?? job.jobId}
                    job={job}
                    active={(activeJob?.id ?? activeJob?.jobId) === (job.id ?? job.jobId)}
                    onClick={() => {
                      setActiveJob(job);
                      setGenStage("done");
                      setError(null);
                    }}
                    onReuse={() => {
                      setPrompt(job.originalPrompt ?? job.prompt);
                      setActiveJob(null);
                      setGenStage("idle");
                    }}
                    onDelete={() => setDeleteModal({ id: job.id ?? job.jobId, jobId: job.jobId })}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ══ LIGHTBOX ══════════════════════════════════════════════════════════ */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <a href={lightbox} download
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-4 w-4" /> Скачать
          </a>
        </div>
      )}

      {/* ══ DELETE MODAL ══════════════════════════════════════════════════════ */}
      {deleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !deleting && setDeleteModal(null)}
        >
          <div
            className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/10 bg-neutral-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <p className="font-semibold text-white">Удалить изображение?</p>
                <p className="text-sm text-neutral-500">Файл будет удалён безвозвратно</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button type="button" disabled={deleting} onClick={() => setDeleteModal(null)}
                className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm text-neutral-400 hover:bg-white/5 disabled:opacity-50">
                Отмена
              </button>
              <button type="button" disabled={deleting}
                onClick={() => handleDelete(deleteModal.id, deleteModal.jobId)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Micro helpers ─────────────────────────────────────────────────────────────

function AdvancedField({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium text-neutral-400">{label}</label>
        {hint && <span className="text-[10px] text-neutral-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function OverlayBtn({
  icon, label, href, download, onClick, danger,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  download?: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  const cls = cn(
    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition",
    danger
      ? "bg-red-500/80 text-white hover:bg-red-500"
      : "bg-black/60 text-white hover:bg-black/80"
  );
  if (href) return (
    <a href={href} download={download} className={cls} title={label}
      onClick={(e) => e.stopPropagation()}>
      {icon} {label}
    </a>
  );
  return (
    <button type="button" className={cls} title={label}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      {icon} {label}
    </button>
  );
}
