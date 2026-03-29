import { Button } from "./Button";
import { cn } from "./cn";

export type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800",
        className
      )}
      role="alert"
    >
      <p>{message}</p>
      {onRetry ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={onRetry}
        >
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
