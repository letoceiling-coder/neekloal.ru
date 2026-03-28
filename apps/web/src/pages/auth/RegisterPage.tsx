import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";
import { apiClient, ApiError } from "../../lib/apiClient";
import { useAuthStore } from "../../stores/authStore";

type RegisterResponse = {
  accessToken: string;
  user: { id: string; email: string };
  organizationId: string;
};

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();
    if (!em || !password) return;
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
      const data = await apiClient.post<RegisterResponse>("/auth/register", {
        email: em,
        password,
      });
      setSession({
        accessToken: data.accessToken,
        email: data.user.email,
        userId: data.user.id,
        organizationId: data.organizationId,
      });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Не удалось зарегистрироваться.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Регистрация">
      <p className="mb-4 text-center text-sm text-neutral-500">
        Создайте аккаунт. API-ключи можно выпустить позже в разделе «API ключи».
      </p>
      <form className="space-y-4" onSubmit={handleSubmit}>
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <div className="space-y-1.5">
          <label
            htmlFor="register-email"
            className="block text-sm font-medium text-neutral-700"
          >
            Email
          </label>
          <input
            id="register-email"
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
            htmlFor="register-password"
            className="block text-sm font-medium text-neutral-700"
          >
            Пароль
          </label>
          <input
            id="register-password"
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
            htmlFor="register-confirm"
            className="block text-sm font-medium text-neutral-700"
          >
            Повторите пароль
          </label>
          <input
            id="register-confirm"
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
          {loading ? "Создание…" : "Создать аккаунт"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-neutral-500 transition-all duration-200">
        Уже есть аккаунт?{" "}
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
