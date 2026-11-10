// HTTP client shared by every feature (orchestrator zone). Features call `apiFetch` with a Zod schema and never
// use `fetch` directly, so the base URL, credentials and error handling live in one place.
import type { z } from "zod";

const BASE_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  // The session is an HttpOnly cookie set by the backend: never a token in localStorage.
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, res.status === 401 ? "No autorizado" : "Error de la API");

  const body: unknown = res.status === 204 ? null : await res.json();
  // Every response is validated: an unexpected shape fails here, not deep inside a component.
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(res.status, "Respuesta inesperada de la API");
  return parsed.data;
}
