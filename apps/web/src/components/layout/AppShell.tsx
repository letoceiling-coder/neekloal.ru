import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Outlet } from "react-router-dom";
import { useUiStore } from "../../stores/uiStore";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-10 bg-black/20 transition-opacity duration-200 ease-out md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-20 flex shrink-0 flex-col border-r border-neutral-200 bg-white transition-all duration-200 ease-out",
          "w-60",
          sidebarCollapsed ? "md:w-16" : "md:w-60",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        <Sidebar />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-200 ease-out md:pl-0">
        <header className="sticky top-0 z-[5] border-b border-neutral-200/80 bg-white/90 backdrop-blur-sm transition-all duration-200 ease-out">
          <div className="flex h-14 items-center gap-3 px-4 md:px-6">
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition-all duration-200 ease-out hover:bg-neutral-50 md:hidden"
              aria-label="Открыть меню"
              aria-expanded={sidebarOpen}
              onClick={toggleSidebar}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-700 transition-all duration-200 ease-out hover:bg-neutral-50 md:inline-flex"
              aria-label={
                sidebarCollapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"
              }
              onClick={toggleSidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-5 w-5 transition-transform duration-200" aria-hidden />
              ) : (
                <PanelLeftClose className="h-5 w-5 transition-transform duration-200" aria-hidden />
              )}
            </button>
            <h1 className="min-w-0 text-sm font-semibold tracking-tight text-neutral-900 transition-all duration-200">
              Панель CRM
            </h1>
          </div>
        </header>
        <main className="flex-1 p-4 transition-all duration-200 ease-out md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
