import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AdminPlan } from "../../api/admin";
import {
  AllowedModelsEditor,
  type AllowedModelsValue,
  normalizeFromPlan,
} from "./AllowedModelsEditor";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { cn } from "../ui/cn";

export type PlanEditorPayload = {
  slug: string;
  name: string;
  maxReq: string;
  maxTok: string;
  models: AllowedModelsValue;
};

type PlanEditorDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  plan: AdminPlan | null;
  modelCatalog: string[];
  catalogLoading: boolean;
  catalogError: boolean;
  pending: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: (payload: PlanEditorPayload) => void | Promise<void>;
};

export function PlanEditorDialog({
  open,
  mode,
  plan,
  modelCatalog,
  catalogLoading,
  catalogError,
  pending,
  saveError,
  onClose,
  onSave,
}: PlanEditorDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [maxReq, setMaxReq] = useState("");
  const [maxTok, setMaxTok] = useState("");
  const [models, setModels] = useState<AllowedModelsValue>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "create") {
      setSlug("");
      setName("");
      setMaxReq("");
      setMaxTok("");
      setModels([]);
    } else if (plan) {
      setSlug(plan.slug);
      setName(plan.name);
      setMaxReq(plan.maxRequestsPerMonth == null ? "" : String(plan.maxRequestsPerMonth));
      setMaxTok(plan.maxTokensPerMonth == null ? "" : String(plan.maxTokensPerMonth));
      setModels(normalizeFromPlan(plan.allowedModels));
    }
  }, [open, mode, plan]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const s = slug.trim().toLowerCase();
    const n = name.trim();
    if (mode === "create" && !s) {
      setLocalError("Укажите slug");
      return;
    }
    if (!n) {
      setLocalError("Укажите название");
      return;
    }
    if (models === "*") {
      await onSave({ slug: s, name: n, maxReq, maxTok, models });
      return;
    }
    if (models.length === 0) {
      setLocalError('Выберите модели или отметьте «Все модели (*)»');
      return;
    }
    await onSave({ slug: s, name: n, maxReq, maxTok, models });
  }

  const err = localError || saveError;

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed left-1/2 top-1/2 z-[100] w-[min(100vw-1.5rem,520px)] max-h-[min(92vh,720px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-neutral-200 bg-white p-0 shadow-xl",
        "[&::backdrop]:bg-black/45 [&::backdrop]:backdrop-blur-[1px]"
      )}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && !pending) onClose();
      }}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex max-h-[min(92vh,720px)] flex-col">
        <div className="border-b border-neutral-100 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-neutral-900">
            {mode === "create" ? "Новый план" : "Редактирование плана"}
          </h2>
          {mode === "edit" && plan ? (
            <p className="mt-1 font-mono text-xs text-neutral-500">{plan.slug}</p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {mode === "create" ? (
            <Input
              id="plan-editor-slug"
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="pro-plus"
              autoComplete="off"
              disabled={pending}
              required
            />
          ) : null}
          <Input
            id="plan-editor-name"
            label="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pro Plus"
            disabled={pending}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="plan-editor-mr"
              label="Запросов / мес (пусто = ∞)"
              value={maxReq}
              onChange={(e) => setMaxReq(e.target.value)}
              placeholder="1000"
              inputMode="numeric"
              disabled={pending}
            />
            <Input
              id="plan-editor-mt"
              label="Токенов / мес (пусто = ∞)"
              value={maxTok}
              onChange={(e) => setMaxTok(e.target.value)}
              placeholder="500000"
              inputMode="numeric"
              disabled={pending}
            />
          </div>
          {catalogError ? (
            <p className="text-xs text-amber-800">Не удалось загрузить каталог моделей.</p>
          ) : null}
          <AllowedModelsEditor
            planId={plan?.id ?? "new"}
            value={models}
            onChange={setModels}
            availableModels={modelCatalog}
            catalogLoading={catalogLoading}
            disabled={pending}
          />
          {err ? (
            <p className="text-sm text-red-600" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 px-5 py-4">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => !pending && onClose()}>
            Отмена
          </Button>
          <Button type="submit" loading={pending} disabled={pending}>
            Сохранить
          </Button>
        </div>
      </form>
    </dialog>
  );
}
