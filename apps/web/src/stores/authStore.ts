import { create } from "zustand";

const STORAGE_KEY = "crm_auth_v2";

export type AuthState = {
  accessToken: string | null;
  email: string | null;
  userId: string | null;
  organizationId: string | null;
  isAuthenticated: boolean;
  /** true после первого чтения localStorage (или явной setSession / logout) */
  isHydrated: boolean;
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

/**
 * Читает `crm_auth_v2`, обновляет store и выставляет `isHydrated: true`.
 * Вызывать до первого React render (`main.tsx`) и при `storage` из других вкладок.
 */
export function hydrateAuthFromStorage(): void {
  const next = readPersisted();
  useAuthStore.setState({
    accessToken: next.accessToken ?? null,
    email: next.email ?? null,
    userId: next.userId ?? null,
    organizationId: next.organizationId ?? null,
    isAuthenticated: Boolean(next.accessToken),
    isHydrated: true,
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  email: null,
  userId: null,
  organizationId: null,
  isAuthenticated: false,
  isHydrated: false,
  setSession: (payload) => {
    const next = {
      accessToken: payload.accessToken,
      email: payload.email,
      userId: payload.userId,
      organizationId: payload.organizationId,
      isAuthenticated: true,
      isHydrated: true,
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
      isHydrated: true,
    });
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    hydrateAuthFromStorage();
  });
}
