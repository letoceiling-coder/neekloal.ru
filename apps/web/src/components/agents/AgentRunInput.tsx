import type { FormEvent } from "react";
import { Button } from "../ui/Button";

export type AgentRunInputProps = {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export function AgentRunInput({
  value,
  onChange,
  onRun,
  disabled,
  loading,
}: AgentRunInputProps) {
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!disabled && !loading && value.trim()) onRun();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="agent-run-input" className="block text-xs font-medium text-neutral-600">
        Ввод для агента
      </label>
      <textarea
        id="agent-run-input"
        rows={4}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 disabled:cursor-not-allowed disabled:opacity-60"
        placeholder="Опишите задачу…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        aria-busy={loading}
      />
      <Button type="submit" loading={loading} disabled={disabled || !value.trim()}>
        Запустить
      </Button>
    </form>
  );
}
