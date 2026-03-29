import { useMemo, useState } from "react";
import { KNOWN_AI_MODELS } from "../../config/aiModels";
import { Input } from "../ui/Input";
import { cn } from "../ui/cn";

export type AllowedModelsValue = "*" | string[];

export function normalizeFromPlan(allowed: unknown): AllowedModelsValue {
  if (allowed === "*" || (typeof allowed === "string" && allowed.trim() === "*")) {
    return "*";
  }
  if (!Array.isArray(allowed)) return [];
  const out: string[] = [];
  for (const x of allowed) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out;
}

type AllowedModelsEditorProps = {
  planId: string;
  value: AllowedModelsValue;
  onChange: (next: AllowedModelsValue) => void;
  disabled?: boolean;
};

export function AllowedModelsEditor({
  planId,
  value,
  onChange,
  disabled,
}: AllowedModelsEditorProps) {
  const allModels = value === "*";
  const selected = useMemo(
    () => (value === "*" ? new Set<string>() : new Set(value)),
    [value]
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [...KNOWN_AI_MODELS];
    return KNOWN_AI_MODELS.filter((m) => m.toLowerCase().includes(q));
  }, [search]);

  function setAll(checked: boolean) {
    if (checked) onChange("*");
    else onChange([]);
  }

  function toggleModel(id: string, checked: boolean) {
    if (allModels) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange([...next]);
  }

  const baseId = `plan-models-${planId}`;

  return (
    <div className="flex min-w-[240px] max-w-[320px] flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-900">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-neutral-300"
          checked={allModels}
          disabled={disabled}
          onChange={(e) => setAll(e.target.checked)}
        />
        Все модели (*)
      </label>
      {!allModels ? (
        <>
          <Input
            id={`${baseId}-search`}
            placeholder="Поиск модели…"
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm"
          />
          <div
            className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-neutral-100 bg-white p-2"
            role="group"
            aria-label="Модели"
          >
            {filtered.length === 0 ? (
              <p className="px-1 py-2 text-xs text-neutral-500">Нет совпадений</p>
            ) : (
              filtered.map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50",
                    disabled && "pointer-events-none opacity-50"
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-neutral-300"
                    checked={selected.has(m)}
                    disabled={disabled}
                    onChange={(e) => toggleModel(m, e.target.checked)}
                  />
                  <span className="font-mono text-xs">{m}</span>
                </label>
              ))
            )}
          </div>
          {selected.size === 0 ? (
            <p className="text-xs text-amber-700">Выберите модели или отметьте «Все модели»</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
