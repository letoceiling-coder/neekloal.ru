import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  children: ReactNode;
};

export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 p-4 transition-all duration-200 ease-out">
      <div className="w-full max-w-[400px] rounded-xl border border-neutral-200 bg-white p-8 shadow-sm transition-all duration-200 ease-out">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight text-neutral-900">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
