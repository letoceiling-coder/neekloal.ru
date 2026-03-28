import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <AuthCard title="Забыли пароль?">
      {sent ? (
        <p className="text-center text-sm text-neutral-600 transition-all duration-200">
          Если такой адрес есть в системе, мы отправим ссылку для сброса пароля
          (демо: API позже).
        </p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label
              htmlFor="forgot-email"
              className="block text-sm font-medium text-neutral-700"
            >
              Электронная почта
            </label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 transition-all duration-200 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800"
          >
            Отправить ссылку
          </button>
        </form>
      )}
      <div className="mt-6 text-center text-sm transition-all duration-200">
        <Link
          to="/login"
          className="font-medium text-neutral-900 underline-offset-2 transition-all duration-200 hover:underline"
        >
          ← Назад ко входу
        </Link>
      </div>
    </AuthCard>
  );
}
