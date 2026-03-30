import { ChevronUp, LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { useUiStore } from "../../stores/uiStore";

function initialsFromEmail(email: string | null): string {
  if (!email || email.trim() === "") return "?";
  const ch = email.trim()[0];
  return ch.toUpperCase();
}

export function SidebarUserPanel() {
  const navigate = useNavigate();
  const email = useAuthStore((s) => s.email);
  const logout = useAuthStore((s) => s.logout);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleMouseDown);
    }
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  if (!email) return null;

  const initial = initialsFromEmail(email);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 border-t border-neutral-200 p-2 transition-all duration-200 ease-out"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-all duration-200 ease-out hover:bg-neutral-100",
          sidebarCollapsed ? "justify-center" : "justify-between",
        ].join(" ")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={email}
      >
        <div
          className={[
            "flex min-w-0 items-center gap-2",
            sidebarCollapsed ? "justify-center" : "flex-1",
          ].join(" ")}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-800 transition-all duration-200">
            {initial}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-neutral-900">{email}</p>
            </div>
          )}
        </div>
        {!sidebarCollapsed && (
          <ChevronUp
            className={[
              "h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-200 ease-out",
              open ? "rotate-180" : "rotate-0",
            ].join(" ")}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div
          className="absolute bottom-full left-2 right-2 z-30 mb-1 overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-lg transition-all duration-200 ease-out"
          role="menu"
        >
          <Link
            to="/settings"
            role="menuitem"
            className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-800 transition-all duration-200 hover:bg-neutral-50"
            onClick={() => setOpen(false)}
          >
            <User className="h-4 w-4 shrink-0" aria-hidden />
            Профиль
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-800 transition-all duration-200 hover:bg-neutral-50"
            onClick={() => {
              logout();
              setOpen(false);
              navigate("/login", { replace: true });
            }}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
