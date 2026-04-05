/**
 * ImageStudioPage — полный рерайт UI (Midjourney / Runway / Leonardo AI level)
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Loader2, Download, Trash2, RotateCcw, Eye,
  ChevronDown, ChevronUp, Upload, X, Scissors, Settings2,
  ImageIcon, ZoomIn, Clock, Paintbrush, Eraser,
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";

console.log("NEW UI LOADED");

const API = import.meta.env.VITE_API_URL ?? "/api";

// ── Types ────────────────────────────────────────────────────────────────────

type QuickOption = "variations" | "reference" | "edit" | "inpaint" | "controlnet" | "removeBg";

interface BrainMeta {
  type?: string;
  typeLabel?: string;
  style?: string;
  composition?: string;
  suggestedMode?: string;
  directivesCount?: number;
  qualityCount?: number;
  modeApplied?: string;
  directives?: { must?: string[]; should?: string[]; quality?: string[] };
}

interface PipelineStep {
  type: "brain" | "enhance" | "generate" | "postprocess";
  action?: string;
  mode?: string;
  model?: string;
  count?: number;
  label: string;
}

interface PipelineMeta {
  stepsCount: number;
  steps: PipelineStep[];
  autoMode: boolean;
  autoRemoveBg: boolean;
}

interface ExecutionStep {
  type: "brain" | "enhance" | "generate" | "postprocess";
  action?: string;
  mode?: string;
  label: string;
  status: "pending" | "running" | "done" | "queued" | "skipped" | "failed";
  output?: Record<string, unknown> | null;
  error?: string | null;
  durationMs?: number;
}

interface ImageJob {
  id?: string;
  jobId: string;
  jobIds?: string[];
  pipelineId?: string;
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
  brain?: BrainMeta | null;
  pipeline?: PipelineMeta | null;
  pipelineExecution?: ExecutionStep[] | null;
}

interface EnhanceInfo {
  enhancedPrompt: string;
  negativePrompt?: string;
  style?: string | null;
  aspectRatio?: string | null;
  brain?: { type: string; typeLabel?: string; style: string; composition: string; suggestedMode?: string } | null;
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
  { id: "variations",  label: "Вариации",    emoji: "🎯", desc: "Несколько версий" },
  { id: "reference",   label: "Сохранить товар", emoji: "🛍", desc: "Товар сохранится, изменится фон и модель" },
  { id: "edit",        label: "Редактировать", emoji: "🖌️", desc: "Кисть · только маска меняется" },
  { id: "inpaint",     label: "Inpaint",     emoji: "✏️", desc: "Полная замена области" },
  { id: "controlnet",  label: "ControlNet",  emoji: "🧬", desc: "Контроль формы/позы" },
  { id: "removeBg",    label: "Убрать фон",  emoji: "✂️", desc: "Прозрачный PNG" },
];

const PRESET_SIZES = [
  { label: "1:1",  w: 1024, h: 1024 },
  { label: "16:9", w: 1344, h: 768  },
  { label: "9:16", w: 768,  h: 1344 },
  { label: "4:3",  w: 1024, h: 768  },
];

// ── Client-side Brain (mirrors aiBrainV2.js — zero latency, priority-based) ──

interface BrainDetection {
  type: string; label: string; style: string; mode: string;
}

// Priority-ordered rules — first match wins (same logic as server aiBrainV2.js)
const CLIENT_PRIORITY_RULES: {
  type: string; label: string; style: string;
  test: (p: string) => boolean;
}[] = [
  { type: "ui",           label: "UI / Интерфейс", style: "modern UI design, glassmorphism",
    test: (p) => p.includes("ui ") || p.includes(" ui") || p.includes("интерфейс") || p.includes("дашборд") || p.includes("dashboard") || p.includes("сайт дизайн") },
  { type: "logo",         label: "Логотип",         style: "minimalist logo, vector style",
    test: (p) => p.includes("логотип") || p.includes("logo") || p.includes("эмблема") || p.includes("app icon") || p.includes("иконка приложения") },
  { type: "banner",       label: "Баннер",           style: "modern marketing banner, bold typography",
    test: (p) => p.includes("баннер") || p.includes("banner") || p.includes("обложка") || p.includes("постер") || p.includes("poster") || p.includes("реклама") || p.includes("флаер") },
  { type: "character",    label: "Персонаж",         style: "cinematic portrait",
    test: (p) => p.includes("персонаж") || p.includes("герой") || p.includes("character") || p.includes("portrait") || p.includes("портрет") || p.includes("в одежде") || p.includes("в сапогах") || p.includes("в шляпе") || p.includes("warrior") || p.includes("knight") || p.includes("wizard") || p.includes("ninja") || p.includes("samurai") || p.includes("woman") || p.includes("man ") || p.includes("girl") || p.includes("boy") || p.includes("женщина") || p.includes("мужчина") || p.includes("девушка") || p.includes("парень") || p.includes("человек") || p.includes("лицо") || p.includes("face") },
  { type: "food",         label: "Еда",              style: "food photography, styled",
    test: (p) => p.includes("еда") || p.includes("food") || p.includes("пицца") || p.includes("pizza") || p.includes("бургер") || p.includes("burger") || p.includes("суши") || p.includes("sushi") || p.includes("торт") || p.includes("cake") || p.includes("кофе") || p.includes("coffee") || p.includes("завтрак") || p.includes("обед") || p.includes("ужин") || p.includes("десерт") || p.includes("блюдо") },
  { type: "architecture", label: "Архитектура",      style: "architectural photography",
    test: (p) => p.includes("здание") || p.includes("building") || p.includes("замок") || p.includes("castle") || p.includes("город") || p.includes("city") || p.includes("интерьер") || p.includes("interior") || p.includes("архитектура") || p.includes("башня") || p.includes("мост") || p.includes("храм") },
  { type: "product",      label: "Продукт",          style: "studio product photography",
    test: (p) => p.includes("айфон") || p.includes("iphone") || p.includes("продукт") || p.includes("product") || p.includes("товар") || p.includes("бутылка") || p.includes("упаковка") || p.includes("духи") || p.includes("телефон") || p.includes("ноутбук") || p.includes("часы") || p.includes("машина") || p.includes("car") },
  { type: "landscape",    label: "Пейзаж",           style: "epic landscape, golden hour",
    test: (p) => p.includes("пейзаж") || p.includes("landscape") || p.includes("горы") || p.includes("гора") || p.includes("mountain") || p.includes("лес") || p.includes("forest") || p.includes("море") || p.includes("ocean") || p.includes("закат") || p.includes("sunset") || p.includes("природа") || p.includes("пляж") || p.includes("снег") },
  { type: "animal",       label: "Животное",         style: "wildlife photography",
    test: (p) => p.includes("кот") || p.includes("кошка") || p.includes("cat") || p.includes("собака") || p.includes("dog") || p.includes("волк") || p.includes("wolf") || p.includes("медведь") || p.includes("bear") || p.includes("тигр") || p.includes("tiger") || p.includes("птица") || p.includes("bird") || p.includes("лошадь") || p.includes("horse") || p.includes("дракон") || p.includes("dragon") || p.includes("животное") || p.includes("animal") },
  { type: "abstract",     label: "Абстракция",       style: "digital art, vivid colors",
    test: (p) => p.includes("абстракция") || p.includes("abstract") || p.includes("фрактал") || p.includes("fractal") || p.includes("неон") || p.includes("neon") || p.includes("космос") || p.includes("galaxy") || p.includes("мандала") || p.includes("mandala") },
];

// Style override rules (same as server)
const CLIENT_STYLE_OVERRIDES: { test: (p: string) => boolean; style: string }[] = [
  { test: (p) => p.includes("аниме") || p.includes("anime"),                     style: "anime style" },
  { test: (p) => p.includes("3d") || p.includes("трёхмерный"),                   style: "3D render" },
  { test: (p) => p.includes("акварель") || p.includes("watercolor"),             style: "watercolor painting" },
  { test: (p) => p.includes("реалистичный") || p.includes("photorealistic"),     style: "photorealistic" },
  { test: (p) => p.includes("пиксар") || p.includes("pixar"),                    style: "Pixar 3D style" },
  { test: (p) => p.includes("киберпанк") || p.includes("cyberpunk"),             style: "cyberpunk, neon lights" },
  { test: (p) => p.includes("фэнтези") || p.includes("fantasy"),                style: "fantasy art, epic" },
  { test: (p) => p.includes("минимал") || p.includes("minimal"),                style: "minimalist, clean" },
  { test: (p) => p.includes("винтаж") || p.includes("vintage") || p.includes("ретро"), style: "vintage, retro" },
];

function clientDetectBrain(text: string): BrainDetection | null {
  if (!text || text.trim().length < 3) return null;
  const p = text.toLowerCase();

  // Type (priority)
  let matched = CLIENT_PRIORITY_RULES.find((r) => r.test(p));
  if (!matched) return null;

  // Style override
  const styleOverride = CLIENT_STYLE_OVERRIDES.find((r) => r.test(p));
  const style = styleOverride ? styleOverride.style : matched.style;

  // Mode
  const mode = (p.includes("варианты") || p.includes("несколько") || p.includes("variations"))
    ? "Variation" : "Text";

  return { type: matched.type, label: matched.label, style, mode };
}

const STAGE_STEPS: { stage: GenStage; label: string }[] = [
  { stage: "enhancing", label: "Улучшение промпта" },
  { stage: "queuing",   label: "Отправка в очередь" },
  { stage: "rendering", label: "Рендеринг" },
];

const MODE_ICON: Record<string, string> = {
  text: "🧠", variation: "🎯", reference: "🛍", product: "🛍", edit: "🖌️", inpaint: "✏️", controlnet: "🧬",
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Live AI Brain chip — shown under textarea while user types, zero API calls */
function BrainChip({ prompt, smartMode }: { prompt: string; smartMode: boolean }) {
  if (!smartMode) return null;
  const brain = clientDetectBrain(prompt);
  if (!brain) return null;

  const TYPE_EMOJI: Record<string, string> = {
    character: "🧑", animal: "🐾", landscape: "🌄", architecture: "🏛",
    product: "📦", food: "🍕", abstract: "✨", banner: "🎯",
    logo: "💎", ui: "🖥",
  };

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-violet-400 font-medium">
        <span>🧠</span>
        <span>AI Brain</span>
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
        <div>
          <p className="text-neutral-600 mb-0.5">Тип</p>
          <p className="text-violet-300 font-medium">
            {TYPE_EMOJI[brain.type] ?? "🎨"} {brain.label}
          </p>
        </div>
        <div>
          <p className="text-neutral-600 mb-0.5">Стиль</p>
          <p className="text-violet-300 font-medium truncate">{brain.style}</p>
        </div>
        <div>
          <p className="text-neutral-600 mb-0.5">Режим</p>
          <p className="text-violet-300 font-medium">{brain.mode}</p>
        </div>
      </div>
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

// ── MaskPainterModal ──────────────────────────────────────────────────────────

/**
 * Full-screen canvas brush tool.
 * Draws an orange mask overlay on top of the reference image.
 * On apply: converts drawn areas to white-on-black B&W PNG (ComfyUI mask format).
 */
function MaskPainterModal({
  imageUrl,
  targetW,
  targetH,
  onApply,
  onClose,
}: {
  imageUrl: string;
  targetW: number;
  targetH: number;
  onApply: (blob: Blob) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [brushSize, setBrushSize] = useState(40);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const painting = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // Black background on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function doPaint(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!painting.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);

    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(255, 100, 20, 0.9)";
      ctx.fillStyle = "rgba(255, 100, 20, 0.9)";
    }

    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPos.current = pos;
  }

  function handleClear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function handleApply() {
    const canvas = canvasRef.current!;

    // Convert colored strokes → white-on-black B&W (ComfyUI mask format)
    const off = document.createElement("canvas");
    off.width = canvas.width;
    off.height = canvas.height;
    const offCtx = off.getContext("2d")!;
    offCtx.fillStyle = "black";
    offCtx.fillRect(0, 0, off.width, off.height);

    const src = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    const dst = offCtx.createImageData(off.width, off.height);
    for (let i = 0; i < src.data.length; i += 4) {
      // Any non-black pixel with meaningful alpha = masked area
      const isMarked = src.data[i + 3] > 30 && (src.data[i] > 30 || src.data[i + 1] > 5 || src.data[i + 2] > 5);
      const v = isMarked ? 255 : 0;
      dst.data[i]     = v;
      dst.data[i + 1] = v;
      dst.data[i + 2] = v;
      dst.data[i + 3] = 255;
    }
    offCtx.putImageData(dst, 0, 0);

    off.toBlob((blob) => { if (blob) onApply(blob); }, "image/png");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 p-3 gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-neutral-900 px-3 py-2">
        <span className="text-xs font-semibold text-neutral-200 mr-2">
          🖌️ Закрасьте область для изменения
        </span>

        <button
          type="button"
          onClick={() => setTool("brush")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition",
            tool === "brush"
              ? "border-orange-500/60 bg-orange-500/20 text-orange-300"
              : "border-transparent bg-white/5 text-neutral-400 hover:bg-white/10"
          )}
        >
          <Paintbrush className="h-3.5 w-3.5" /> Кисть
        </button>

        <button
          type="button"
          onClick={() => setTool("eraser")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition",
            tool === "eraser"
              ? "border-blue-500/60 bg-blue-500/20 text-blue-300"
              : "border-transparent bg-white/5 text-neutral-400 hover:bg-white/10"
          )}
        >
          <Eraser className="h-3.5 w-3.5" /> Ластик
        </button>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-500">Размер</span>
          <input
            type="range" min={8} max={150} step={4}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24 accent-orange-500"
          />
          <span className="w-7 text-right text-[11px] text-neutral-400">{brushSize}px</span>
        </div>

        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1 text-xs font-medium text-neutral-400 transition hover:bg-red-500/20 hover:text-red-400"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Очистить
        </button>

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:bg-white/5"
          >
            <X className="h-3.5 w-3.5" /> Отмена
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-400"
          >
            ✓ Применить маску
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative overflow-hidden rounded-xl"
          style={{ aspectRatio: `${targetW}/${targetH}`, maxHeight: "100%", maxWidth: "100%" }}
        >
          <img
            src={imageUrl}
            alt="reference"
            className="h-full w-full object-cover"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            width={targetW}
            height={targetH}
            className="absolute inset-0 h-full w-full cursor-crosshair"
            style={{ opacity: 0.55, mixBlendMode: "hard-light" }}
            onPointerDown={(e) => {
              painting.current = true;
              lastPos.current = null;
              doPaint(e);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={doPaint}
            onPointerUp={() => { painting.current = false; lastPos.current = null; }}
            onPointerLeave={() => { painting.current = false; lastPos.current = null; }}
          />
        </div>
      </div>

      <p className="text-center text-[11px] text-neutral-600">
        Оранжевая область → изменится · Остальное сохранится · Ластик убирает маску
      </p>
    </div>
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
  /** Product img2img denoise (0.3 = creative … 0.6 = strict) */
  const [strength, setStrength] = useState(0.45);
  /** IP-Adapter weight when GPU supports nodes (API still accepts 0.3–0.8) */
  const [ipAdapterWeight, setIpAdapterWeight] = useState(0.55);

  // Reference image
  const [refImage, setRefImage]     = useState<RefImage | null>(null);
  const [maskImage, setMaskImage]   = useState<RefImage | null>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [maskUploading, setMaskUploading] = useState(false);

  // Mask painter
  const [showMaskPainter, setShowMaskPainter] = useState(false);

  // Generation
  const [genStage, setGenStage]     = useState<GenStage>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob]   = useState<ImageJob | null>(null);
  const generating = genStage !== "idle" && genStage !== "done";

  // Parallel variation tracking
  const [parallelJobIds, setParallelJobIds]       = useState<string[]>([]);
  const [parallelResults, setParallelResults]     = useState<Map<string, ImageJob>>(new Map());
  const parallelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Parallel variation polling
  useEffect(() => {
    if (parallelJobIds.length === 0) return;
    if (parallelPollRef.current) clearInterval(parallelPollRef.current);

    parallelPollRef.current = setInterval(async () => {
      const updates = new Map<string, ImageJob>(parallelResults);
      let anyError = false;

      for (const jid of parallelJobIds) {
        const prev = updates.get(jid);
        if (prev?.status === "completed" || prev?.status === "failed") continue;

        try {
          const res = await fetch(`${API}/image/status/${jid}`, { headers });
          if (!res.ok) continue;
          const job = await res.json() as ImageJob;
          if (job.dbIds?.length) job.id = job.dbIds[0];
          updates.set(jid, job);
          if (job.status === "failed") anyError = true;
        } catch { /* ignore */ }
      }

      setParallelResults(new Map(updates));

      // Check if ALL are terminal
      const allTerminal = parallelJobIds.every((jid) => {
        const j = updates.get(jid);
        return j?.status === "completed" || j?.status === "failed";
      });

      if (allTerminal || anyError) {
        if (parallelPollRef.current) clearInterval(parallelPollRef.current);
        setGenStage("done");
        loadHistory();

        // Merge all completed URLs into activeJob for display
        const allUrls = parallelJobIds
          .map((jid) => updates.get(jid))
          .filter((j) => j?.status === "completed")
          .flatMap((j) => j?.urls ?? (j?.url ? [j.url] : []));

        if (allUrls.length > 0) {
          setActiveJob((prev) => prev ? {
            ...prev,
            status: "completed",
            urls: allUrls,
            url:  allUrls[0],
            count: allUrls.length,
          } : null);
        }

        // Auto remove-bg (first image)
        if (activeOptions.has("removeBg") && allUrls[0]) {
          doRemoveBg(allUrls[0]);
        }
      }
    }, 3000);

    return () => { if (parallelPollRef.current) clearInterval(parallelPollRef.current); };
  }, [parallelJobIds]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const toggleOption = useCallback((opt: QuickOption) => {
    setActiveOptions((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      // Mutex: only one image-source option at a time
      if (opt !== "removeBg" && opt !== "variations") {
        for (const o of ["reference", "edit", "inpaint", "controlnet"] as QuickOption[]) {
          if (o !== opt) next.delete(o);
        }
      }
      return next;
    });
  }, []);

  function resolveMode(): string {
    if (activeOptions.has("variations"))  return "variation";
    if (activeOptions.has("controlnet") && refImage) return "controlnet";
    if (activeOptions.has("edit") && refImage) return "edit";
    if (activeOptions.has("inpaint") && refImage && maskImage) return "inpaint";
    if (activeOptions.has("reference") && refImage) return "product";
    return "text";
  }

  async function handleMaskApply(blob: Blob) {
    setShowMaskPainter(false);
    setMaskUploading(true);
    try {
      const file = new File([blob], "mask.png", { type: "image/png" });
      const refUrl = await uploadRefFile(file);
      setMaskImage({ previewUrl: URL.createObjectURL(blob), refUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки маски");
    } finally {
      setMaskUploading(false);
    }
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
    setParallelJobIds([]);
    setParallelResults(new Map());

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
      if (mode === "product" || mode === "reference" || mode === "inpaint" || mode === "edit") {
        body.referenceImageUrl = refImage?.refUrl;
        body.strength = strength;
      }
      if (mode === "product") body.ipAdapterWeight = ipAdapterWeight;
      if (mode === "inpaint" || mode === "edit") body.maskUrl = maskImage?.refUrl;

      const res  = await fetch(`${API}/image/generate`, { method: "POST", headers, body: JSON.stringify(body) });
      const data = await res.json() as {
        jobId?: string;
        jobIds?: string[];
        pipelineId?: string;
        error?: string;
        brain?: BrainMeta | null;
        pipeline?: PipelineMeta | null;
        pipelineExecution?: ExecutionStep[] | null;
      };

      if (!res.ok) {
        setError("Ошибка генерации. Попробуйте изменить описание.");
        setGenStage("idle");
        return;
      }

      setGenStage("rendering");

      const primaryJobId = data.jobId!;
      const allJobIds    = data.jobIds ?? [primaryJobId];
      const isParallel   = allJobIds.length > 1;

      setActiveJob({
        jobId:             primaryJobId,
        jobIds:            allJobIds,
        pipelineId:        data.pipelineId,
        status:            "queued",
        mode,
        prompt:            finalPrompt,
        originalPrompt:    raw,
        width:             size.w,
        height:            size.h,
        createdAt:         new Date().toISOString(),
        brain:             data.brain             ?? null,
        pipeline:          data.pipeline          ?? null,
        pipelineExecution: data.pipelineExecution ?? null,
      });

      if (isParallel) {
        // Reset parallel state and start parallel polling
        setParallelResults(new Map());
        setParallelJobIds(allJobIds);
      } else {
        // Single job — use existing poll
        setParallelJobIds([]);
        setActiveJobId(primaryJobId);
      }
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

  // For parallel variations: merge all completed image URLs
  const parallelUrls: string[] = parallelJobIds.length > 1
    ? Array.from(parallelResults.values())
        .filter((j) => j.status === "completed")
        .flatMap((j) => j.urls ?? (j.url ? [j.url] : []))
    : [];

  const images: string[] = parallelUrls.length > 0
    ? parallelUrls
    : activeJob?.urls?.length
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

              {/* ── Edit mode: ref image + canvas mask painter ──────────────── */}
              {activeOptions.has("edit") && (
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-orange-400">🖌️ Редактирование кистью</p>

                  {/* 1. Ref image upload */}
                  <p className="mb-1.5 text-[10px] text-neutral-500">1. Загрузите исходное изображение</p>
                  <button
                    type="button"
                    onClick={() => refInputRef.current?.click()}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed py-2.5 text-xs transition",
                      refImage
                        ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
                        : "border-white/10 text-neutral-500 hover:border-orange-500/30 hover:text-neutral-300"
                    )}
                  >
                    {refUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : refImage ? (
                      <>
                        <img src={refImage.previewUrl} alt="" className="h-7 w-7 rounded object-cover" />
                        <span className="text-orange-300">Изображение загружено ✓</span>
                      </>
                    ) : (
                      <><Upload className="h-4 w-4" /> Загрузить изображение</>
                    )}
                  </button>

                  {/* 2. Draw mask */}
                  {refImage && (
                    <>
                      <p className="mb-1.5 mt-2.5 text-[10px] text-neutral-500">2. Нарисуйте маску (область изменения)</p>
                      <button
                        type="button"
                        onClick={() => setShowMaskPainter(true)}
                        className={cn(
                          "flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition",
                          maskImage
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                            : "border-orange-500/40 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25"
                        )}
                      >
                        {maskUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : maskImage ? (
                          <>
                            <img src={maskImage.previewUrl} alt="" className="h-6 w-6 rounded object-cover opacity-80" />
                            <span>Маска нарисована ✓ · Перерисовать</span>
                          </>
                        ) : (
                          <><Paintbrush className="h-4 w-4" /> Открыть редактор кисти</>
                        )}
                      </button>

                      {/* Strength slider */}
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
                          <span>Сила изменения</span>
                          <span>{Math.round(strength * 100)}%</span>
                        </div>
                        <input type="range" min="0.15" max="0.75" step="0.05" value={strength}
                          onChange={(e) => setStrength(Number(e.target.value))}
                          className="w-full accent-orange-500"
                        />
                        <div className="flex justify-between text-[9px] text-neutral-600 mt-0.5">
                          <span>Мягко</span><span>Сильно</span>
                        </div>
                      </div>
                    </>
                  )}

                  {!refImage && (
                    <p className="mt-2 text-center text-[10px] text-neutral-600">
                      Сначала загрузите изображение
                    </p>
                  )}
                </div>
              )}

              {(activeOptions.has("reference") || activeOptions.has("inpaint") || activeOptions.has("controlnet")) && (
                <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                  <p className="mb-2 text-[11px] font-medium text-neutral-400">
                    {activeOptions.has("controlnet")
                      ? "🧬 Изображение для ControlNet"
                      : activeOptions.has("reference")
                        ? "🛍 Фото товара / одежды"
                        : "🖼 Изображение-основа"}
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
                    <div className="mt-2 space-y-3">
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                          <span>Точность товара</span>
                          <span>{strength.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="0.6"
                          step="0.05"
                          value={strength}
                          onChange={(e) => setStrength(Number(e.target.value))}
                          className="w-full accent-violet-500"
                        />
                        <div className="flex justify-between text-[9px] text-neutral-600 mt-0.5">
                          <span>0.3 креативнее</span>
                          <span>0.6 строже</span>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1">
                          <span>Удержание образа (IP-Adapter)</span>
                          <span>{ipAdapterWeight.toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="0.8"
                          step="0.05"
                          value={ipAdapterWeight}
                          onChange={(e) => setIpAdapterWeight(Number(e.target.value))}
                          className="w-full accent-fuchsia-500"
                        />
                        <div className="flex justify-between text-[9px] text-neutral-600 mt-0.5">
                          <span>0.3 мягче</span>
                          <span>0.8 сильнее</span>
                        </div>
                      </div>
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
            <div className="flex flex-col items-center gap-4 w-full">
              <ProgressBar stage={genStage} />
              {/* Parallel variation slots */}
              {parallelJobIds.length > 1 && (
                <div className={cn(
                  "grid w-full max-w-2xl gap-2",
                  parallelJobIds.length === 2 ? "grid-cols-2" : "grid-cols-2"
                )}>
                  {parallelJobIds.map((jid) => {
                    const r = parallelResults.get(jid);
                    const done = r?.status === "completed";
                    const failed = r?.status === "failed";
                    const imgUrl = r?.url ?? r?.urls?.[0];
                    return (
                      <div key={jid} className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/5 bg-neutral-900">
                        {done && imgUrl ? (
                          <img src={imgUrl} alt="" className="h-full w-full object-cover" />
                        ) : failed ? (
                          <div className="flex h-full items-center justify-center text-red-400 text-xs">❌</div>
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-neutral-600" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

          {/* AI Applied panel */}
          {genStage === "done" && activeJob?.status === "completed" && activeJob.brain && (
            <div className="mt-3 w-full max-w-2xl rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                🧠 AI применил
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ...(activeJob.brain.directives?.must?.slice(0, 3) ?? []),
                  ...(activeJob.brain.directives?.quality?.slice(0, 2) ?? []),
                ].map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-300">
                    <span className="text-violet-400">✔</span> {tag}
                  </span>
                ))}
                {activeJob.brain.typeLabel && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-neutral-700/40 px-2.5 py-1 text-[11px] text-neutral-400">
                    {activeJob.brain.typeLabel}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Pipeline panel */}
          {genStage === "done" && activeJob?.status === "completed" && activeJob.pipeline && (
            <div className="mt-2 w-full max-w-2xl rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">🔗 Pipeline</p>
                {activeJob.pipelineId && (
                  <span className="font-mono text-[9px] text-neutral-700" title="Pipeline ID">
                    {activeJob.pipelineId.slice(0, 8)}…
                  </span>
                )}
              </div>
              <ol className="flex flex-col gap-1">
                {activeJob.pipeline.steps.map((step, i) => {
                  const icon =
                    step.type === "brain"       ? "🧠" :
                    step.type === "enhance"     ? "✨" :
                    step.type === "generate"    ? "🖼" :
                    step.type === "postprocess" ? "✂️" : "•";

                  // Match with execution result
                  const exec = activeJob.pipelineExecution?.[i];
                  const statusDot =
                    exec?.status === "done"    ? <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" title="done" /> :
                    exec?.status === "queued"  ? <span className="h-2 w-2 rounded-full bg-yellow-400 flex-shrink-0" title="queued" /> :
                    exec?.status === "pending" ? <span className="h-2 w-2 rounded-full bg-neutral-600 flex-shrink-0" title="pending" /> :
                    exec?.status === "skipped" ? <span className="h-2 w-2 rounded-full bg-neutral-500 flex-shrink-0" title="skipped" /> :
                    exec?.status === "failed"  ? <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" title="failed" /> :
                    <span className="h-2 w-2 rounded-full bg-neutral-700 flex-shrink-0" />;

                  const durationLabel = exec?.durationMs && exec.durationMs > 50
                    ? <span className="ml-auto text-[10px] text-neutral-600">{exec.durationMs}ms</span>
                    : null;

                  return (
                    <li key={i} className="flex items-center gap-2 text-[12px] text-neutral-400">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] font-bold text-neutral-500">
                        {i + 1}
                      </span>
                      {statusDot}
                      <span>{icon}</span>
                      <span className="flex-1">{step.label}</span>
                      {exec?.status === "failed" && exec.error && (
                        <span className="text-[10px] text-red-400 truncate max-w-[120px]" title={exec.error}>⚠ {exec.error.slice(0, 30)}</span>
                      )}
                      {durationLabel}
                    </li>
                  );
                })}
              </ol>
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

      {/* ══ MASK PAINTER ══════════════════════════════════════════════════════ */}
      {showMaskPainter && refImage && (
        <MaskPainterModal
          imageUrl={refImage.previewUrl}
          targetW={size.w}
          targetH={size.h}
          onApply={handleMaskApply}
          onClose={() => setShowMaskPainter(false)}
        />
      )}

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
