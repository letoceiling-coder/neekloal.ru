import { useEffect, useId, useRef } from "react";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Красная кнопка подтверждения */
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  destructive,
  pending,
  onConfirm,
  onClose,
}: AdminConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[100] w-[min(100vw-2rem,420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-0 shadow-xl",
        "[&::backdrop]:bg-black/45 [&::backdrop]:backdrop-blur-[1px]"
      )}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !pending) onClose();
      }}
    >
      <div className="p-5">
        <h2 id={titleId} className="text-base font-semibold text-neutral-900">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">{description}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            className="min-h-9"
            onClick={() => !pending && onClose()}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "secondary" : "primary"}
            className={cn(
              "min-h-9",
              destructive &&
                "border-red-200 bg-red-600 text-white hover:bg-red-700 hover:text-white"
            )}
            disabled={pending}
            loading={pending}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
