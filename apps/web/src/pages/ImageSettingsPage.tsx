import { useEffect, useState } from "react";
import { Loader2, Save, Settings2, Info } from "lucide-react";
import { useAuthStore } from "../stores/authStore";

const API = import.meta.env.VITE_API_URL ?? "/api";

function cn(...cls: (string | false | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

export function ImageSettingsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authHeaders = {
    Authorization: `Bearer ${accessToken ?? ""}`,
    "Content-Type": "application/json",
  };

  const [systemPrompt, setSystemPrompt] = useState("");
  const [useSystemPrompt, setUseSystemPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/image/settings`, { headers: authHeaders })
      .then((r) => r.json())
      .then((d) => {
        setSystemPrompt(d.imageSystemPrompt ?? "");
        setUseSystemPrompt(d.useSystemPrompt ?? false);
      })
      .catch(() => setError("Не удалось загрузить настройки"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${API}/image/settings`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ imageSystemPrompt: systemPrompt, useSystemPrompt }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  const EXAMPLES = [
    {
      label: "Фотография еды",
      text: "Create professional food photography. Use appetizing presentation, natural lighting, shallow depth of field.",
    },
    {
      label: "Архитектура",
      text: "Focus on architectural details, use dramatic angles, golden-hour or blue-hour lighting.",
    },
    {
      label: "Портрет",
      text: "Portrait style: face clearly visible, soft bokeh background, studio or natural lighting.",
    },
    {
      label: "Продуктовый арт",
      text: "Clean product photography on white or gradient background, studio lighting, sharp details.",
    },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
          <Settings2 className="h-5 w-5 text-violet-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Настройки Image Studio</h1>
          <p className="text-sm text-neutral-500">Системный промпт влияет на все генерации при включённом умном режиме</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-neutral-300" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Toggle */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4">
            <div>
              <p className="text-sm font-medium text-neutral-900">Использовать системный промпт</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Если включено, умный режим (AI) получит дополнительные инструкции перед улучшением
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUseSystemPrompt((v) => !v)}
              className={cn(
                "relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                useSystemPrompt ? "bg-violet-600" : "bg-neutral-200"
              )}
              role="switch"
              aria-checked={useSystemPrompt}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200",
                  useSystemPrompt ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* System prompt textarea */}
          <div className={cn("flex flex-col gap-2 transition-opacity", !useSystemPrompt && "opacity-40 pointer-events-none")}>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-700">Системный промпт</label>
              <span className="text-[11px] text-neutral-400">{systemPrompt.length} симв.</span>
            </div>
            <textarea
              className="min-h-[140px] w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-900 placeholder-neutral-400 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
              placeholder="Например: Always use cinematic lighting and emphasize depth of field…"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={!useSystemPrompt}
            />
            <p className="flex items-start gap-1.5 text-[11px] text-neutral-400">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              Пишите на английском для лучшего результата. LLM получает эти инструкции перед улучшением промпта.
            </p>
          </div>

          {/* Examples */}
          <div className={cn("flex flex-col gap-2", !useSystemPrompt && "opacity-40 pointer-events-none")}>
            <p className="text-xs font-medium text-neutral-500">Примеры</p>
            <div className="grid grid-cols-2 gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  disabled={!useSystemPrompt}
                  onClick={() => setSystemPrompt(ex.text)}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50"
                >
                  <p className="text-xs font-medium text-neutral-700">{ex.label}</p>
                  <p className="mt-0.5 text-[10px] text-neutral-400 line-clamp-2 break-words">{ex.text}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition",
              saving
                ? "cursor-not-allowed bg-neutral-100 text-neutral-400"
                : saved
                ? "bg-green-500 text-white"
                : "bg-violet-600 text-white hover:bg-violet-700 active:scale-[0.98]"
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saved ? "Сохранено ✓" : "Сохранить настройки"}
          </button>
        </div>
      )}
    </div>
  );
}
