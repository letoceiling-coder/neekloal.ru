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
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 text-neutral-900">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          className="fixed inset-0 z-10 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          "flex h-full shrink-0 flex-col border-r border-neutral-200 bg-white transition-all duration-200 ease-out",
          "fixed inset-y-0 left-0 z-20 w-60 md:static md:inset-auto md:z-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
          sidebarCollapsed ? "md:w-16" : "md:w-60",
        ].join(" ")}
      >
        <Sidebar />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-[5] shrink-0 border-b border-neutral-200/80 bg-white/90 backdrop-blur-sm">
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
              DEPLOY OK 777
            </h1>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto bg-white p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
