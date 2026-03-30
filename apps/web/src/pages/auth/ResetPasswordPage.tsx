import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";
import { apiClient, ApiError } from "../../lib/apiClient";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token.trim()) {
      setError("Нет токена в ссылке. Запросите сброс пароля снова.");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (password.length < 8) {
      setError("Пароль не короче 8 символов");
      return;
    }
    setLoading(true);
    try {
      await apiClient.post("/auth/reset-password", { token: token.trim(), password });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сбросить пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Сброс пароля">
      {!token.trim() ? (
        <p className="text-center text-sm text-red-700">
          Ссылка недействительна или устарела. Запросите новую на странице «Забыли
          пароль».
        </p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <label
              htmlFor="reset-password"
              className="block text-sm font-medium text-neutral-700"
            >
              Новый пароль
            </label>
            <input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="reset-confirm"
              className="block text-sm font-medium text-neutral-700"
            >
              Повторите пароль
            </label>
            <input
              id="reset-confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800 disabled:opacity-60"
          >
            {loading ? "Сохранение…" : "Сохранить пароль"}
          </button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-neutral-500 transition-all duration-200">
        <Link
          to="/login"
          className="font-medium text-neutral-900 underline-offset-2 transition-all duration-200 hover:underline"
        >
          Вход
        </Link>
      </p>
    </AuthCard>
  );
}
