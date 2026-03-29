import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label?: string;
  error?: string;
};

export function Input({ id, label, error, className, ...props }: InputProps) {
  return (
    <div className="min-w-0 flex-1">
      {label ? (
        <label
          htmlFor={id}
          className="block text-xs font-medium text-neutral-600"
        >
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className={cn(
          "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400",
          "focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900/15",
          label ? "mt-1" : undefined,
          error
            ? "border-red-300 focus:border-red-300 focus:ring-red-200"
            : undefined,
          className
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
