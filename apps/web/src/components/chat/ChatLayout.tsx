import type { ReactNode } from "react";
import { cn } from "../ui/cn";

export type ChatLayoutProps = {
  sidebar: ReactNode;
  main: ReactNode;
  className?: string;
};

export function ChatLayout({ sidebar, main, className }: ChatLayoutProps) {
  return (
    <div
      className={cn(
        "flex min-h-[min(70vh,640px)] w-full max-w-6xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm",
        className
      )}
    >
      <aside className="flex w-[min(100%,280px)] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/50">
        {sidebar}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        {main}
      </section>
    </div>
  );
}
