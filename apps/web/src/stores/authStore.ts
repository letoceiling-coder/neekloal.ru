import { create } from "zustand";

type AuthState = {
  /** Единственный источник авторизации для API (Bearer). */
  apiKey: string | null;
  isAuthenticated: boolean;
  setApiKey: (key: string | null) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  apiKey: null,
  isAuthenticated: false,
  setApiKey: (key) => {
    const trimmed = key?.trim() || null;
    set({
      apiKey: trimmed,
      isAuthenticated: Boolean(trimmed),
    });
  },
  logout: () =>
    set({
      apiKey: null,
      isAuthenticated: false,
    }),
}));
