import { useAuthStore } from "../stores/authStore";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getBaseUrl(): string {
  const u = import.meta.env.VITE_API_URL;
  if (u == null || String(u).trim() === "") {
    throw new Error("VITE_API_URL не задан. Укажите URL API в .env");
  }
  return String(u).replace(/\/$/, "");
}

function authPaths(): string[] {
  return ["/login", "/register", "/forgot-password", "/reset-password"];
}

function handleUnauthorized(): void {
  useAuthStore.getState().logout();
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (!authPaths().some((p) => path === p)) {
    window.location.assign("/login");
  }
}

async function parseErrorBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

type RequestOpts = RequestInit & { jsonBody?: unknown };

/**
 * Единственная точка HTTP: только через этот модуль (не использовать fetch напрямую).
 */
async function request<T>(method: string, path: string, init?: RequestOpts): Promise<T> {
  const base = getBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${normalized}`;

  const { jsonBody, body: initBody, headers: initHeaders, ...restInit } = init || {};
  const headers = new Headers(initHeaders);

  const apiKey = useAuthStore.getState().apiKey;
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  let body: BodyInit | null | undefined = initBody as BodyInit | undefined;
  if (jsonBody !== undefined) {
    body = JSON.stringify(jsonBody);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const res = await fetch(url, {
    ...restInit,
    method,
    headers,
    body: body ?? null,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError("Не авторизован", 401);
  }

  if (!res.ok) {
    const bodyParsed = await parseErrorBody(res);
    const msg =
      typeof bodyParsed === "object" &&
      bodyParsed !== null &&
      "error" in bodyParsed &&
      typeof (bodyParsed as { error: unknown }).error === "string"
        ? (bodyParsed as { error: string }).error
        : `Ошибка ${res.status}`;
    throw new ApiError(msg, res.status, bodyParsed);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const ct = res.headers.get("content-type");
  if (ct?.includes("application/json")) {
    return (await res.json()) as T;
  }

  return undefined as T;
}

export const apiClient = {
  get: <T>(path: string, init?: RequestOpts) => request<T>("GET", path, init),

  post: <T>(path: string, jsonBody?: unknown, init?: Omit<RequestOpts, "jsonBody" | "body">) =>
    request<T>("POST", path, { ...init, jsonBody }),

  put: <T>(path: string, jsonBody?: unknown, init?: Omit<RequestOpts, "jsonBody" | "body">) =>
    request<T>("PUT", path, { ...init, jsonBody }),

  patch: <T>(path: string, jsonBody?: unknown, init?: Omit<RequestOpts, "jsonBody" | "body">) =>
    request<T>("PATCH", path, { ...init, jsonBody }),

  delete: <T>(path: string, init?: RequestOpts) => request<T>("DELETE", path, init),
};
