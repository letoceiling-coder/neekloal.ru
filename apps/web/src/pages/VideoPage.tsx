import { useEffect, useMemo, useState } from "react";
import { Film, Sparkles } from "lucide-react";
import { Button, Card, CardContent, CardHeader, Input } from "../components/ui";
import { getVideoStatus, useGenerateVideo, useVideoQueue } from "../api/video";
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
};

const MODE_OPTIONS: { id: UiMode; label: string }[] = [
  { id: "text", label: "🎬 Текст → Видео" },
  { id: "photo", label: "🖼 Оживить фото" },
  { id: "ad", label: "📦 Реклама товара" },
  { id: "cinema", label: "🎥 Кино сцена" },
];

function modePrefix(mode: UiMode) {
  if (mode === "photo") return "image-to-video animation, smooth camera motion,";
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

export default function VideoPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("2");
  const [fps, setFps] = useState("12");
  const [mode, setMode] = useState<UiMode>("text");
  const [imageUrl, setImageUrl] = useState("");
  const [jobs, setJobs] = useState<VideoJobItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);

  const generateMutation = useGenerateVideo();
  const queueQuery = useVideoQueue();
  const hasActiveJobs = jobs.some((j) => j.status === "queued" || j.status === "processing");

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

    const durationNum = Math.max(1, Math.min(8, Number(duration) || 2));
    const fpsNum = [8, 12, 16, 24].includes(Number(fps)) ? Number(fps) : 12;

    try {
      const data = await generateMutation.mutateAsync({
        prompt: `${modePrefix(mode)} ${prompt.trim()}`,
        duration: durationNum,
        fps: fpsNum,
        mode: mode === "photo" ? "image2video" : "text",
        imageUrl: mode === "photo" ? imageUrl.trim() || undefined : undefined,
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
              <Input
                id="video-image-url"
                label="Ссылка на фото (для оживления)"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
              />
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
                loading={generateMutation.isPending}
                disabled={!prompt.trim() || (mode === "photo" && !imageUrl.trim()) || generateMutation.isPending}
                className="w-full py-2.5 text-base"
              >
                🚀 Создать видео
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {sortedJobs.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-neutral-200 p-8 text-center text-sm text-neutral-500">
            Создайте своё первое видео 🚀
          </div>
        ) : (
          sortedJobs.map((job) => (
            <Card key={job.id} className="transition-all duration-300 hover:shadow-md">
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium text-neutral-800">{job.prompt}</p>
                  <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusBadgeClass(job.status)}`}>
                    {statusLabel(job.status)}
                  </span>
                </div>

                <div className="grid gap-2 text-xs text-neutral-600 sm:grid-cols-3">
                  <span>ETA: {job.eta ?? "—"} сек</span>
                  <span>Позиция: {job.position ?? "—"}</span>
                  <span>Прогресс: {job.progress}%</span>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                    <span>Генерация... {job.progress}%</span>
                    <span>{job.progress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-neutral-200">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-neutral-800 to-neutral-500 transition-all duration-700 ease-out"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>

                {job.error ? <p className="text-sm text-red-600">{job.error}</p> : null}

                {job.status === "completed" && job.url ? (
                  <div className="space-y-2">
                    <video
                      controls
                      src={job.url}
                      className="w-full rounded-lg border border-neutral-200 bg-black"
                    />
                    <div className="grid gap-2 sm:grid-cols-3">
                      <a
                        href={job.url}
                        download
                        className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                      >
                        Скачать
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setPrompt(job.prompt);
                          setMode(job.mode);
                        }}
                        className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Повторить
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrompt(job.prompt)}
                        className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Использовать снова
                      </button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

