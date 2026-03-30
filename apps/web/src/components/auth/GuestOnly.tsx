import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";

/** Разрешает страницы входа только гостям; иначе — на дашборд. */
export function GuestOnly() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
