import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Bot,
  Cpu,
  Image,
  Key,
  LayoutDashboard,
  MessageSquare,
  Send,
  Settings,
  Store,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useUiStore } from "../../stores/uiStore";
import { SidebarUserPanel } from "./SidebarUserPanel";

export const sidebarNav: {
  to: string;
  label: string;
  Icon: LucideIcon;
}[] = [
  { to: "/dashboard", label: "Дашборд", Icon: LayoutDashboard },
  { to: "/assistants", label: "Ассистенты", Icon: Bot },
  { to: "/agents", label: "Агенты", Icon: Cpu },
  { to: "/conversations", label: "Диалоги", Icon: MessageSquare },
  { to: "/knowledge", label: "База знаний", Icon: BookOpen },
  { to: "/api-keys", label: "API ключи", Icon: Key },
  { to: "/image-studio", label: "Image Studio", Icon: Image },
  { to: "/avito",        label: "Avito",        Icon: Store },
  { to: "/telegram",     label: "Telegram Bot", Icon: Send },
  { to: "/analytics",   label: "Аналитика",    Icon: BarChart3 },
  { to: "/settings",    label: "Настройки",    Icon: Settings },
];

export function Sidebar() {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);

  return (
    <>
      <div
        className={[
          "flex h-14 shrink-0 items-center border-b border-neutral-200 transition-all duration-200 ease-out",
          sidebarCollapsed ? "justify-center px-2" : "px-4",
        ].join(" ")}
      >
        {!sidebarCollapsed ? (
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400 transition-all duration-200 ease-out">
            Разделы
          </span>
        ) : (
          <span className="sr-only">Разделы</span>
        )}
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden p-2 transition-all duration-200 ease-out">
        {sidebarNav.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-md py-2 text-sm transition-all duration-200 ease-out",
                sidebarCollapsed ? "justify-center px-2" : "px-3",
                isActive
                  ? "bg-neutral-900 font-medium text-white"
                  : "text-neutral-700 hover:bg-neutral-100",
              ].join(" ")
            }
            onClick={() => setSidebarOpen(false)}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            {!sidebarCollapsed && (
              <span className="min-w-0 truncate transition-all duration-200 ease-out">{label}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <SidebarUserPanel />
    </>
  );
}
