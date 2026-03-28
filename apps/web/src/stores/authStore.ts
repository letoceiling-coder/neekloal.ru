import { create } from "zustand";

const STORAGE_KEY = "crm_auth_v2";

export type AuthState = {
  accessToken: string | null;
  email: string | null;
  userId: string | null;
  organizationId: string | null;
  isAuthenticated: boolean;
  setSession: (payload: {
    accessToken: string;
    email: string;
    userId: string;
    organizationId: string;
  }) => void;
  logout: () => void;
};

function readPersisted(): Partial<
  Pick<AuthState, "accessToken" | "email" | "userId" | "organizationId" | "isAuthenticated">
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, unknown>;
    const accessToken = typeof p.accessToken === "string" ? p.accessToken : null;
    const email = typeof p.email === "string" ? p.email : null;
    const userId = typeof p.userId === "string" ? p.userId : null;
    const organizationId = typeof p.organizationId === "string" ? p.organizationId : null;
    return {
      accessToken,
      email,
      userId,
      organizationId,
      isAuthenticated: Boolean(accessToken),
    };
  } catch {
    return {};
  }
}

const persisted = readPersisted();

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: persisted.accessToken ?? null,
  email: persisted.email ?? null,
  userId: persisted.userId ?? null,
  organizationId: persisted.organizationId ?? null,
  isAuthenticated: persisted.isAuthenticated ?? false,
  setSession: (payload) => {
    const next = {
      accessToken: payload.accessToken,
      email: payload.email,
      userId: payload.userId,
      organizationId: payload.organizationId,
      isAuthenticated: true,
    };
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    set(next);
  },
  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({
      accessToken: null,
      email: null,
      userId: null,
      organizationId: null,
      isAuthenticated: false,
    });
  },
}));
