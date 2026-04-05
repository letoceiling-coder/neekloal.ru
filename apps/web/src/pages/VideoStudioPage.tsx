/**
 * Video Studio — генерация видео из изображения + сценарий + опциональная озвучка
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Film, Loader2, Download, Upload, AlertCircle, ImageIcon } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

const API = import.meta.env.VITE_API_URL ?? "/api";

type VideoJobStatus = "queued" | "processing" | "completed" | "failed";

interface VideoJobRow {
  jobId: string;
  status: VideoJobStatus;
  outputUrl: string | null;
  error: string | null;
  createdAt?: string;
}

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

function StatusBadge({ status }: { status: VideoJobStatus }) {
  const map: Record<VideoJobStatus, { label: string; className: string }> = {
    queued: { label: "В очереди", className: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    processing: { label: "Генерация", className: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
    completed: { label: "Готово", className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    failed: { label: "Ошибка", className: "bg-red-500/20 text-red-300 border-red-500/30" },
  };
  const { label, className } = map[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium", className)}>
      {status === "queued" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
      {status === "processing" && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
      {label}
    </span>
  );
}

export function VideoStudioPage() {
  useEffect(() => {
    console.log("VIDEO PAGE LOADED");
  }, []);

  const accessToken = useAuthStore((s) => s.accessToken);
  const jsonHeaders = {
    Authorization: `Bearer ${accessToken ?? ""}`,
    "Content-Type": "application/json",
  };

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<VideoJobRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const uploadRefFile = useCallback(
    async (file: File): Promise<string> => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/image/upload-ref`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        body: fd,
      });
      if (!res.ok) throw new Error("Не удалось загрузить изображение");
      const d = (await res.json()) as { refUrl: string };
      return d.refUrl;
    },
    [accessToken]
  );

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const hasPending = jobs.some((j) => j.status === "queued" || j.status === "processing");

  useEffect(() => {
    if (!accessToken || !hasPending) return;

    const pollOnce = async () => {
      const pending = jobsRef.current.filter(
        (j) => j.status === "queued" || j.status === "processing"
      );
      for (const row of pending) {
        try {
          const res = await fetch(`${API}/video/status/${row.jobId}`, {
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          });
          if (!res.ok) continue;
          const data = (await res.json()) as {
            jobId: string;
            status: VideoJobStatus;
            outputUrl: string | null;
            error: string | null;
            createdAt?: string;
            updatedAt?: string;
          };
          setJobs((prev) =>
            prev.map((j) =>
              j.jobId === data.jobId
                ? {
                    ...j,
                    status: data.status,
                    outputUrl: data.outputUrl ?? null,
                    error: data.error ?? null,
                    createdAt: data.createdAt ?? j.createdAt,
                  }
                : j
            )
          );
        } catch {
          /* ignore transient network errors */
        }
      }
    };

    void pollOnce();
    const id = window.setInterval(() => void pollOnce(), 2500);
    return () => window.clearInterval(id);
  }, [accessToken, hasPending]);

  function onPickFile(f: File | null) {
    setFormError(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (!f) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    setImageFile(f);
    setImagePreview(URL.createObjectURL(f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const s = script.trim();
    if (!imageFile) {
      setFormError("Загрузите изображение");
      return;
    }
    if (!s) {
      setFormError("Введите сценарий");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const imageUrl = await uploadRefFile(imageFile);
      const body: { imageUrl: string; script: string; voiceText?: string } = {
        imageUrl,
        script: s,
      };
      const vt = voiceText.trim();
      if (vt) body.voiceText = vt;

      const res = await fetch(`${API}/video/generate`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      const raw = (await res.json().catch(() => ({}))) as { jobId?: string; status?: string; error?: string };
      if (!res.ok) {
        throw new Error(raw.error || `Ошибка ${res.status}`);
      }
      if (!raw.jobId) throw new Error("Сервер не вернул jobId");

      setJobs((prev) => [
        {
          jobId: raw.jobId!,
          status: (raw.status as VideoJobStatus) || "queued",
          outputUrl: null,
          error: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ошибка отправки");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-neutral-950 md:h-screen md:max-h-[calc(100vh-3.5rem)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500">
            <Film className="h-3.5 w-3.5 text-white" aria-hidden />
          </div>
          <span className="text-sm font-semibold text-white">Video Studio</span>
        </div>
        <Link
          to="/image-studio"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-white/5 hover:text-white"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          Image Studio
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row">
        {/* LEFT — form */}
        <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-white/5 bg-neutral-900 p-4 lg:w-[380px] lg:border-b-0 lg:border-r">
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-300">Изображение</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-sm text-neutral-400 transition hover:border-violet-500/40 hover:bg-white/[0.05]"
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt=""
                    className="max-h-32 max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <>
                    <Upload className="h-8 w-8 text-neutral-500" />
                    <span>Нажмите для загрузки</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-300">Сценарий</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Опишите движение и сцену для видео..."
                rows={5}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 [overflow-wrap:anywhere]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-neutral-400">Озвучка (необязательно)</label>
              <textarea
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                placeholder="Текст для TTS; если пусто — без голоса"
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-neutral-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 [overflow-wrap:anywhere]"
              />
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition",
                submitting
                  ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
                  : "bg-violet-600 text-white hover:bg-violet-500"
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  ⏳ Генерация...
                </>
              ) : (
                "Сгенерировать видео"
              )}
            </button>
          </form>
        </aside>

        {/* RIGHT — list */}
        <section className="min-h-0 flex-1 overflow-y-auto bg-neutral-950 p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">Результаты</h2>
          {jobs.length === 0 ? (
            <p className="text-sm text-neutral-500">Здесь появятся сгенерированные видео</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {jobs.map((job) => (
                <li
                  key={job.jobId}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/80"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-2">
                    <code className="max-w-[200px] truncate text-[11px] text-neutral-500">{job.jobId}</code>
                    <StatusBadge status={job.status} />
                  </div>

                  <div className="p-4">
                    {job.status === "queued" && (
                      <div className="flex flex-col items-center justify-center gap-3 py-10 text-neutral-400">
                        <Loader2 className="h-10 w-10 animate-spin text-violet-400" />
                        <p className="text-sm">В очереди…</p>
                      </div>
                    )}

                    {job.status === "processing" && (
                      <div className="flex flex-col gap-3 py-6">
                        <div className="flex items-center gap-2 text-sm text-violet-300">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Генерация видео…
                        </div>
                        <div
                          className="h-1.5 w-full rounded-full bg-white/10"
                          role="progressbar"
                          aria-label="Прогресс генерации"
                        >
                          <div className="h-full w-full rounded-full bg-violet-500/50 animate-pulse" />
                        </div>
                      </div>
                    )}

                    {job.status === "completed" && job.outputUrl && (
                      <div className="flex flex-col gap-3">
                        <video
                          src={job.outputUrl}
                          controls
                          playsInline
                          className="w-full max-h-[320px] rounded-lg bg-black"
                        />
                        <a
                          href={job.outputUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10"
                        >
                          <Download className="h-4 w-4" />
                          Скачать
                        </a>
                      </div>
                    )}

                    {job.status === "failed" && (
                      <div className="flex items-start gap-2 py-4 text-sm text-red-300">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{job.error || "Неизвестная ошибка"}</span>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default VideoStudioPage;
