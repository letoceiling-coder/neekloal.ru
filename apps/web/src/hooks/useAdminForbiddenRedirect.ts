import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/apiClient";

/** 403 на admin API → на дашборд (нет root). */
export function useAdminForbiddenRedirect() {
  const navigate = useNavigate();
  return (err: unknown) => {
    if (err instanceof ApiError && err.status === 403) {
      navigate("/dashboard", { replace: true });
    }
  };
}
