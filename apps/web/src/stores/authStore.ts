import { create } from "zustand";

const STORAGE_KEY = "crm_auth_v2";

export type PlatformRole = "user" | "admin" | "root";

export type AuthState = {
  accessToken: string | null;
  email: string | null;
  userId: string | null;
  organizationId: string | null;
  /** с сервера (login/register); для старых записей в localStorage может отсутствовать */
  role: PlatformRole | null;
  isAuthenticated: boolean;
  /** true после первого чтения localStorage (или явной setSession / logout) */
  isHydrated: boolean;
  setSession: (payload: {
    accessToken: string;
    email: string;
    userId: string;
    organizationId: string;
    role: PlatformRole;
  }) => void;
  logout: () => void;
};

function parseRole(v: unknown): PlatformRole | null {
  if (v === "user" || v === "admin" || v === "root") return v;
  return null;
}

function readPersisted(): Partial<
  Pick<
    AuthState,
    "accessToken" | "email" | "userId" | "organizationId" | "role" | "isAuthenticated"
  >
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
    const role = parseRole(p.role);
    return {
      accessToken,
      email,
      userId,
      organizationId,
      role,
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
    role: next.role ?? null,
    isAuthenticated: Boolean(next.accessToken),
    isHydrated: true,
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  email: null,
  userId: null,
  organizationId: null,
  role: null,
  isAuthenticated: false,
  isHydrated: false,
  setSession: (payload) => {
    const next = {
      accessToken: payload.accessToken,
      email: payload.email,
      userId: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
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
      role: null,
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
