import { Button } from "./Button";
import { cn } from "./cn";

export type EmptyStateProps = {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-10 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-neutral-900">{title}</p>
      {description ? (
        <p className="mt-2 text-sm text-neutral-500">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
