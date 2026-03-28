import { type FormEvent, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";
import { useAuthStore } from "../../stores/authStore";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const [apiKey, setApiKeyInput] = useState("");

  const from =
    (location.state as { from?: string } | null)?.from ?? "/dashboard";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    navigate(from, { replace: true });
  }

  return (
    <AuthCard title="Вход">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label
            htmlFor="login-api-key"
            className="block text-sm font-medium text-neutral-700"
          >
            API ключ
          </label>
          <input
            id="login-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            required
            value={apiKey}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="sk-…"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
          />
          <p className="text-xs text-neutral-500">
            Ключ передаётся в заголовке{" "}
            <span className="font-mono">Authorization: Bearer</span>
          </p>
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800"
        >
          Войти
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
          Нет ключа?{" "}
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
