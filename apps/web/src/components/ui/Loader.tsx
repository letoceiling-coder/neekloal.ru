import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export type LoaderProps = {
  className?: string;
  label?: string;
};

export function Loader({ className, label = "Загрузка…" }: LoaderProps) {
  return (
    <div
      className={cn("flex items-center gap-2 text-sm text-neutral-500", className)}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
