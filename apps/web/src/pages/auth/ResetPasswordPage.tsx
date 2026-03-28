import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard } from "../../components/auth/AuthCard";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    navigate("/login", { replace: true });
  }

  return (
    <AuthCard title="Сброс пароля">
      <form className="space-y-4" onSubmit={handleSubmit}>
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
          className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-neutral-800"
        >
          Сохранить пароль
        </button>
      </form>
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
