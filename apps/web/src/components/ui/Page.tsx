import type { ReactNode } from "react";
import { cn } from "./cn";

export type PageProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Page({ title, description, children, className }: PageProps) {
  return (
    <div
      className={cn("space-y-6 transition-all duration-200 ease-out", className)}
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
          {title}
        </h2>
        {description ? (
          <div className="mt-1 text-sm text-neutral-500">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
