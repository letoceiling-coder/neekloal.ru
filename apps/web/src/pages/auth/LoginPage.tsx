import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";
import { apiClient, ApiError } from "../../lib/apiClient";
import { type PlatformRole, useAuthStore } from "../../stores/authStore";

type LoginResponse = {
  accessToken: string;
  user: { id: string; email: string; role: PlatformRole };
  organizationId: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const from =
    (location.state as { from?: string } | null)?.from ?? "/dashboard";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();
    if (!em || !password) return;
    setLoading(true);
    try {
      const data = await apiClient.post<LoginResponse>("/auth/login", {
        email: em,
        password,
      });
      setSession({
        accessToken: data.accessToken,
        email: data.user.email,
        userId: data.user.id,
        organizationId: data.organizationId,
        role: data.user.role,
      });
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      navigate(from, { replace: true });
    } catch (err) {
      console.error(err);
      const msg =
        err instanceof ApiError
          ? err.message
          : "Не удалось войти. Проверьте данные.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Вход">
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-neutral-700"
          >
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-neutral-700"
          >
            Пароль
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800 disabled:opacity-60"
        >
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-center text-sm transition-all duration-200">
        <Link
          to="/forgot-password"
          className="text-neutral-600 underline-offset-2 transition-all duration-200 hover:text-neutral-900 hover:underline"
        >
          Забыли пароль?
        </Link>
        <p className="text-neutral-500">
          Нет аккаунта?{" "}
          <Link
            to="/register"
            className="font-medium text-neutral-900 underline-offset-2 transition-all duration-200 hover:underline"
          >
            Регистрация
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
