// HTTP client shared by every feature (orchestrator zone). Features call `apiFetch` with a parser (usually a Zod
// schema's `.parse`) and never use `fetch` directly, so the base URL, credentials and error handling live in one
// place and every response is typed only after it was validated.
const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Turns the unknown JSON body into T, or throws. */
export type Parser<T> = (body: unknown) => T;

export async function apiFetch<T>(path: string, parse: Parser<T>, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  // The session is an HttpOnly cookie set by the backend: never a token in localStorage.
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "No autorizado" : "Error de la API");

  const body: unknown = res.status === 204 ? null : await res.json();
  // An unexpected shape fails here, not deep inside a component.
  try {
    return parse(body);
  } catch {
    throw new ApiError(res.status, "Respuesta inesperada de la API");
  }
}
