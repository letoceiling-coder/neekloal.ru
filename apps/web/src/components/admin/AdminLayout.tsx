import {
  Activity,
  Building2,
  LayoutDashboard,
  ListTree,
  PhoneForwarded,
  Shield,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPlans } from "../../api/admin";
import { ApiError } from "../../lib/apiClient";
import { queryKeys } from "../../queryKeys";
import { useAuthStore } from "../../stores/authStore";
import { Loader } from "../ui";

const nav = [
  { to: "/admin/organizations", label: "Организации", Icon: Building2 },
  { to: "/admin/users", label: "Пользователи", Icon: Users },
  { to: "/admin/plans", label: "Планы", Icon: ListTree },
  { to: "/admin/leads", label: "Лиды", Icon: PhoneForwarded },
  { to: "/admin/usage", label: "Usage", Icon: Activity },
] as const;

export function AdminLayout() {
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  const gate = useQuery({
    // Без accessToken в ключе React Query держит старый 403 после нового логина / смены токена.
    queryKey: [...queryKeys.admin.gate, accessToken ?? "__none__"],
    queryFn: getPlans,
    enabled: isHydrated && Boolean(accessToken),
    retry: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (!isHydrated) return;
    if (gate.error instanceof ApiError && gate.error.status === 403) {
      navigate("/dashboard", { replace: true });
    }
  }, [gate.error, isHydrated, navigate]);

  if (!isHydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50 text-sm text-neutral-600">
        Loading...
      </div>
    );
  }

  if (gate.isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50">
        <Loader />
      </div>
    );
  }

  // 403: редирект в useEffect; не рендерим Outlet — иначе дочерние страницы дернут admin API и useAdminForbiddenRedirect снова уведёт на /dashboard.
  if (gate.error instanceof ApiError && gate.error.status === 403) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-50">
        <Loader />
      </div>
    );
  }

  if (gate.error) {
    const msg =
      gate.error instanceof ApiError ? gate.error.message : "Не удалось проверить доступ";
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-neutral-50 px-4 text-center">
        <p className="text-sm text-neutral-700">{msg}</p>
        <button
          type="button"
          className="text-sm font-medium text-neutral-900 underline"
          onClick={() => void gate.refetch()}
        >
          Повторить
        </button>
        <NavLink to="/dashboard" className="text-sm text-neutral-500 underline">
          На дашборд
        </NavLink>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 text-neutral-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
            <Shield className="h-4 w-4 shrink-0" aria-hidden />
            Админ
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-neutral-900 font-medium text-white"
                    : "text-neutral-700 hover:bg-neutral-100",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-2">
          <NavLink
            to="/dashboard"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
            Дашборд
          </NavLink>
        </div>
      </aside>
      <main className="min-h-0 flex-1 overflow-auto bg-white p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
