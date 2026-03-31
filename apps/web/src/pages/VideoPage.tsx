import { useEffect, useMemo, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import { Button, Card, CardContent, CardHeader, Input } from "../components/ui";
import {
  useGenerateVideo,
  useVideoQueue,
  useVideoStatus,
  type VideoStatusResponse,
} from "../api/video";
import { ApiError } from "../lib/apiClient";

function statusLabel(status?: string) {
  if (status === "queued") return "В очереди";
  if (status === "processing") return "Обработка";
  if (status === "completed") return "Готово";
  if (status === "failed") return "Ошибка";
  return "—";
}

function clampProgress(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export default function VideoPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("2");
  const [fps, setFps] = useState("12");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateMutation = useGenerateVideo();
  const queueQuery = useVideoQueue();
  const statusQuery = useVideoStatus(jobId);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void queueQuery.refetch();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [queueQuery]);

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(() => {
      void statusQuery.refetch();
      void queueQuery.refetch();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [jobId, queueQuery, statusQuery]);

  const status = statusQuery.data as VideoStatusResponse | undefined;
  const progress = clampProgress(status?.progress);
  const completed = status?.status === "completed" && Boolean(status?.url);

  const resultTitle = useMemo(() => {
    if (!jobId) return "Нет активной задачи";
    if (statusQuery.isLoading) return "Загрузка статуса...";
    return `Job ${jobId}`;
  }, [jobId, statusQuery.isLoading]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) {
      setError("Введите prompt");
      return;
    }

    const durationNum = Math.max(1, Math.min(8, Number(duration) || 2));
    const fpsNum = [8, 12, 16, 24].includes(Number(fps)) ? Number(fps) : 12;

    try {
      const data = await generateMutation.mutateAsync({
        prompt: prompt.trim(),
        duration: durationNum,
        fps: fpsNum,
        mode: "text",
      });
      setJobId(data.jobId);
      void statusQuery.refetch();
      void queueQuery.refetch();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Не удалось создать задачу видео");
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow">
          <Film className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Video Studio</h1>
          <p className="text-sm text-neutral-500">Queue, progress and ETA in real-time</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-800">1. FORM</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-3">
              <Input
                id="video-prompt"
                label="Prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="cinematic city, neon lights"
              />
              <Input
                id="video-duration"
                label="Duration (1-8 sec)"
                type="number"
                min={1}
                max={8}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
              <Input
                id="video-fps"
                label="FPS (8,12,16,24)"
                type="number"
                min={8}
                max={24}
                step={1}
                value={fps}
                onChange={(e) => setFps(e.target.value)}
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button
                type="submit"
                loading={generateMutation.isPending}
                disabled={!prompt.trim() || generateMutation.isPending}
                className="w-full"
              >
                Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-800">2. QUEUE</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {queueQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading queue...
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border border-neutral-200 p-2">Waiting: {queueQuery.data?.waiting ?? "—"}</div>
              <div className="rounded-md border border-neutral-200 p-2">Active: {queueQuery.data?.active ?? "—"}</div>
              <div className="rounded-md border border-neutral-200 p-2">Completed: {queueQuery.data?.completed ?? "—"}</div>
              <div className="rounded-md border border-neutral-200 p-2">Failed: {queueQuery.data?.failed ?? "—"}</div>
            </div>

            <div className="rounded-md border border-neutral-200 p-3 text-sm text-neutral-700">
              Avg time: <strong>{queueQuery.data?.avgTimeSec ?? queueQuery.data?.etaModelSecPerJob ?? "—"} sec</strong>
            </div>

            <div className="space-y-1 text-sm">
              <div>Status: {statusLabel(status?.status)}</div>
              <div>Position: {status?.position ?? "—"}</div>
              <div>ETA: {status?.eta ?? "—"} sec</div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-neutral-200">
                <div
                  className="h-2 rounded-full bg-neutral-900 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-800">3. RESULT</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-neutral-600">{resultTitle}</p>
            {!jobId ? <p className="text-sm text-neutral-400">Запустите генерацию для отображения результата.</p> : null}
            {status?.error ? <p className="text-sm text-red-600">{status.error}</p> : null}

            {completed ? (
              <div className="space-y-3">
                <video
                  controls
                  src={status?.url ?? undefined}
                  className="w-full rounded-lg border border-neutral-200 bg-black"
                />
                <a
                  href={status?.url ?? "#"}
                  download
                  className="inline-flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Download video
                </a>
              </div>
            ) : (
              <p className="text-sm text-neutral-400">Видео будет доступно после завершения задачи.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

