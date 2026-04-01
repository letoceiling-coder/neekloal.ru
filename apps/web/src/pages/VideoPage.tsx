import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, Download, Film, ImagePlus, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Button, Card, CardContent, CardHeader, Input } from "../components/ui";
import { getVideoStatus, uploadVideoImage, useGenerateVideo, useVideoQueue } from "../api/video";
import { ApiError } from "../lib/apiClient";

type UiMode = "text" | "photo" | "ad" | "cinema";
type JobStatus = "queued" | "processing" | "completed" | "failed";

type VideoJobItem = {
  id: string;
  prompt: string;
  mode: UiMode;
  status: JobStatus;
  progress: number;
  eta: number | null;
  position: number | null;
  url: string | null;
  error: string | null;
  createdAt: number;
  refPreview: string | null;
};

const MODE_OPTIONS: { id: UiMode; label: string }[] = [
  { id: "text", label: "🎬 Текст → Видео" },
  { id: "photo", label: "🖼 Оживить фото" },
  { id: "ad", label: "📦 Реклама товара" },
  { id: "cinema", label: "🎥 Кино сцена" },
];

function modePrefix(mode: UiMode) {
  if (mode === "photo") return "subtle realistic animation, preserve original image, no distortion, no new objects, gentle motion only,";
  if (mode === "ad") return "commercial product video, clean branding style,";
  if (mode === "cinema") return "cinematic movie scene, dramatic lighting,";
  return "high quality video generation,";
}

function statusLabel(status: JobStatus) {
  if (status === "queued") return "В очереди";
  if (status === "processing") return "Обработка";
  if (status === "completed") return "Готово";
  return "Ошибка";
}

function statusBadgeClass(status: JobStatus) {
  if (status === "processing") return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "queued") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function clampProgress(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function JobCard({
  job,
  onRepeat,
  onUsePrompt,
}: {
  job: VideoJobItem;
  onRepeat: (job: VideoJobItem) => void;
  onUsePrompt: (job: VideoJobItem) => void;
}) {
  const isActive = job.status === "queued" || job.status === "processing";

  return (
    <Card className="overflow-hidden transition-all duration-300 hover:shadow-md">
      <CardContent className="space-y-0 p-0">
        {/* ── Header row ── */}
        <div className="flex items-start gap-3 p-4">
          {job.refPreview ? (
            <img
              src={job.refPreview}
              alt=""
              className="h-14 w-14 flex-shrink-0 rounded-lg border border-neutral-200 object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border border-neutral-100 bg-neutral-50">
              <Film className="h-5 w-5 text-neutral-300" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium text-neutral-800">{job.prompt}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(job.status)}`}>
                {job.status === "processing" ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {statusLabel(job.status)}
                  </span>
                ) : statusLabel(job.status)}
              </span>
              {job.status === "queued" && job.position != null ? (
                <span className="text-xs text-neutral-400">позиция #{job.position}</span>
              ) : null}
              {isActive && job.eta != null ? (
                <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
                  <Clock className="h-3 w-3" />
                  ~{job.eta} сек
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Progress bar (only when active) ── */}
        {isActive ? (
          <div className="px-4 pb-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-neutral-400">
              <span>{job.status === "processing" ? "Генерация..." : "Ожидание..."}</span>
              <span>{job.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div
                className={[
                  "h-1.5 rounded-full transition-all duration-700 ease-out",
                  job.status === "processing"
                    ? "bg-gradient-to-r from-blue-500 to-blue-400"
                    : "bg-gradient-to-r from-amber-400 to-amber-300",
                ].join(" ")}
                style={{ width: job.progress > 0 ? `${job.progress}%` : "8%" }}
              />
            </div>
          </div>
        ) : null}

        {/* ── Error ── */}
        {job.status === "failed" && job.error ? (
          <div className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">
            {job.error}
          </div>
        ) : null}

        {/* ── Completed: video + actions ── */}
        {job.status === "completed" && job.url ? (
          <div className="border-t border-neutral-100">
            <video
              controls
              src={job.url}
              className="w-full bg-black"
              style={{ maxHeight: 320 }}
            />
            <div className="flex flex-wrap gap-2 p-3">
              <a
                href={job.url}
                download
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
              >
                <Download className="h-3.5 w-3.5" />
                Скачать
              </a>
              <button
                type="button"
                onClick={() => onRepeat(job)}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Повторить
              </button>
              <button
                type="button"
                onClick={() => onUsePrompt(job)}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Использовать снова
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function VideoPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("2");
  const [fps, setFps] = useState("12");
  const [mode, setMode] = useState<UiMode>("text");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<VideoJobItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);

  const generateMutation = useGenerateVideo();
  const queueQuery = useVideoQueue();
  const hasActiveJobs = jobs.some((j) => j.status === "queued" || j.status === "processing");

  const applyFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Только изображения (PNG, JPG, WEBP)");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setError(null);
  }, []);

  const clearImage = useCallback(() => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [imagePreview]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void queueQuery.refetch();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [queueQuery]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const active = jobs.filter((j) => j.status === "queued" || j.status === "processing");
        if (active.length === 0) return;
        const results = await Promise.all(
          active.map(async (j) => {
            try {
              return await getVideoStatus(j.id);
            } catch {
              return null;
            }
          }),
        );
        setJobs((prev) =>
          prev.map((job) => {
            const fresh = results.find((r) => r?.jobId === job.id);
            if (!fresh) return job;
            return {
              ...job,
              status: (fresh.status as JobStatus) || job.status,
              progress: clampProgress(fresh.progress),
              eta: fresh.eta ?? null,
              position: fresh.position ?? null,
              url: fresh.url ?? null,
              error: fresh.error ?? null,
            };
          }),
        );
        void queueQuery.refetch();
      })();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, jobs, queueQuery]);

  const sortedJobs = useMemo(() => {
    const rank: Record<JobStatus, number> = {
      processing: 0,
      queued: 1,
      completed: 2,
      failed: 3,
    };
    return [...jobs].sort((a, b) => {
      const dr = rank[a.status] - rank[b.status];
      if (dr !== 0) return dr;
      return b.createdAt - a.createdAt;
    });
  }, [jobs]);

  async function improvePrompt() {
    if (!prompt.trim()) {
      setError("Сначала введите описание видео");
      return;
    }
    setError(null);
    setImproving(true);
    await new Promise((r) => window.setTimeout(r, 700));
    setPrompt(
      `${prompt.trim()}. cinematic lighting, smooth camera movement, ultra detailed, realistic motion, clean composition`,
    );
    setImproving(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError("Введите описание видео");
      return;
    }
    if (mode === "photo" && !imageFile) {
      setError("Загрузите изображение для оживления");
      return;
    }

    const durationNum = Math.max(1, Math.min(8, Number(duration) || 2));
    const fpsNum = [8, 12, 16, 24].includes(Number(fps)) ? Number(fps) : 12;

    let uploadedRefUrl: string | undefined;
    if (mode === "photo" && imageFile) {
      setUploading(true);
      try {
        const res = await uploadVideoImage(imageFile);
        uploadedRefUrl = res.refUrl;
      } catch {
        setError("Не удалось загрузить изображение. Попробуйте ещё раз.");
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    try {
      const data = await generateMutation.mutateAsync({
        prompt: `${modePrefix(mode)} ${prompt.trim()}`,
        duration: durationNum,
        fps: fpsNum,
        mode: mode === "photo" ? "image2video" : "text",
        imageUrl: uploadedRefUrl,
      });

      setJobs((prev) => [
        {
          id: data.jobId,
          prompt: prompt.trim(),
          mode,
          status: data.status as JobStatus,
          progress: 0,
          eta: data.eta ?? null,
          position: data.position ?? null,
          url: null,
          error: null,
          createdAt: Date.now(),
          refPreview: imagePreview,
        },
        ...prev,
      ]);
      void queueQuery.refetch();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError("Не удалось создать задачу видео");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow">
          <Film className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">🎬 Video Studio</h1>
          <p className="text-sm text-neutral-500">Генерация видео с живым прогрессом и очередью</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-neutral-800">Создание видео</h2>
            <div className="flex gap-2 text-xs text-neutral-500">
              <span className="rounded-full border border-neutral-200 px-2 py-1">Ожидают: {queueQuery.data?.waiting ?? 0}</span>
              <span className="rounded-full border border-neutral-200 px-2 py-1">Активные: {queueQuery.data?.active ?? 0}</span>
              <span className="rounded-full border border-neutral-200 px-2 py-1">Среднее: {queueQuery.data?.avgTimeSec ?? queueQuery.data?.etaModelSecPerJob ?? "—"} сек</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {MODE_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={[
                    "rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors",
                    mode === item.id
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="video-prompt" className="mb-1 block text-xs font-medium text-neutral-600">
                Описание видео
              </label>
              <textarea
                id="video-prompt"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Пример: Ночной мегаполис с неоновыми вывесками, плавный пролёт камеры между зданиями, лёгкий дождь, кинематографичный свет."
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15"
              />
              <p className="mt-1 text-xs text-neutral-500">Опишите сцену, стиль, атмосферу и действия</p>
            </div>

            {mode === "photo" ? (
              <div className="space-y-2">
                <label className="mb-1 block text-xs font-medium text-neutral-600">
                  Фото для оживления
                </label>
                {imagePreview ? (
                  <div className="relative inline-block">
                    <img
                      src={imagePreview}
                      alt="Предпросмотр"
                      className="h-40 w-auto rounded-lg border border-neutral-200 object-cover shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={clearImage}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-white shadow hover:bg-neutral-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files[0];
                      if (f) applyFile(f);
                    }}
                    className={[
                      "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
                      dragOver
                        ? "border-neutral-700 bg-neutral-100"
                        : "border-neutral-200 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100",
                    ].join(" ")}
                  >
                    <ImagePlus className="h-8 w-8 text-neutral-400" />
                    <p className="text-sm font-medium text-neutral-600">
                      📤 Перетащите изображение или нажмите для загрузки
                    </p>
                    <p className="text-xs text-neutral-400">PNG, JPG, WEBP — до 20 МБ</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) applyFile(f);
                  }}
                />
              </div>
            ) : null}

            {mode === "ad" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Подсказка: добавьте товар, УТП и целевую аудиторию — так реклама получится убедительнее.
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                id="video-duration"
                label="Длительность (сек)"
                type="number"
                min={1}
                max={8}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
              <Input
                id="video-fps"
                label="Кадров в секунду"
                type="number"
                min={8}
                max={24}
                step={1}
                value={fps}
                onChange={(e) => setFps(e.target.value)}
              />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="secondary"
                loading={improving}
                disabled={!prompt.trim() || improving}
                onClick={() => void improvePrompt()}
                className="w-full py-2.5"
              >
                <Sparkles className="h-4 w-4" />
                ✨ Улучшить описание
              </Button>
              <Button
                type="submit"
                loading={uploading || generateMutation.isPending}
                disabled={
                  !prompt.trim() ||
                  (mode === "photo" && !imageFile) ||
                  uploading ||
                  generateMutation.isPending
                }
                className="w-full py-2.5 text-base"
              >
                {uploading ? "Загрузка фото..." : "🚀 Создать видео"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── JOBS LIST ── */}
      <div className="space-y-3">
        {sortedJobs.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-neutral-200 p-12 text-center">
            <Film className="mx-auto mb-3 h-10 w-10 text-neutral-300" />
            <p className="text-sm font-medium text-neutral-500">Создайте своё первое видео 🚀</p>
            <p className="mt-1 text-xs text-neutral-400">Заполните форму выше и нажмите «Создать видео»</p>
          </div>
        ) : (
          sortedJobs.map((job) => <JobCard key={job.id} job={job} onRepeat={(j) => { setPrompt(j.prompt); setMode(j.mode); }} onUsePrompt={(j) => setPrompt(j.prompt)} />)
        )}
      </div>
    </div>
  );
}

