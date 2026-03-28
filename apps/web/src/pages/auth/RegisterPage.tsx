import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";
import { useAuthStore } from "../../stores/authStore";

/** Для SaaS ключ выдаётся отдельно; здесь только ввод существующего API ключа. */
export function RegisterPage() {
  const navigate = useNavigate();
  const setApiKey = useAuthStore((s) => s.setApiKey);
  const [apiKey, setApiKeyInput] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setApiKey(trimmed);
    navigate("/dashboard", { replace: true });
  }

  return (
    <AuthCard title="Подключение">
      <p className="mb-4 text-center text-sm text-neutral-500">
        Введите выданный вам API ключ для доступа к панели.
      </p>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label
            htmlFor="register-api-key"
            className="block text-sm font-medium text-neutral-700"
          >
            API ключ
          </label>
          <input
            id="register-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            required
            value={apiKey}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800"
        >
          Продолжить
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-neutral-500 transition-all duration-200">
        Уже подключены?{" "}
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
