import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

export type ChatInputProps = {
  onSubmit: (text: string) => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** При смене (например выбран другой диалог) — фокус в поле */
  focusTrigger?: string | null;
};

export function ChatInput({
  onSubmit,
  loading,
  disabled,
  placeholder,
  className,
  focusTrigger,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusTrigger == null || focusTrigger === "") return;
    textareaRef.current?.focus();
  }, [focusTrigger]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading || disabled) return;
    const t = value.trim();
    if (!t) return;
    try {
      await onSubmit(t);
      setValue("");
    } catch {
      /* текст остаётся для повторной отправки; optimistic bubble уже в ленте */
    }
  }

  const blocked = Boolean(loading) || Boolean(disabled);
  const canSend = Boolean(value.trim()) && !blocked;

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("shrink-0 border-t border-neutral-200 bg-white p-3", className)}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder ?? "Сообщение…"}
          rows={2}
          disabled={blocked}
          className="min-h-[44px] w-full resize-y rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:opacity-60"
          onKeyDown={(e) => {
            // Enter — отправка; Shift+Enter — новая строка (стандартное поведение textarea)
            if (e.key !== "Enter" || e.shiftKey) return;
            if (loading || disabled) {
              e.preventDefault();
              return;
            }
            e.preventDefault();
            if (canSend) void handleSubmit(e as unknown as FormEvent);
          }}
        />
        <Button
          type="submit"
          className="shrink-0 sm:mb-0.5"
          loading={loading}
          disabled={!canSend}
        >
          Отправить
        </Button>
      </div>
    </form>
  );
}
