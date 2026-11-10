# Auth en una SPA Vue (el backend es el dueño de la sesión)

Una SPA no guarda secretos: todo su código es público. La autenticación la hace el backend; la SPA solo la refleja.

## Reglas
1. **Sesión en una cookie `HttpOnly`, `Secure` y `SameSite=Lax` (o `Strict`)** que pone el backend. La SPA nunca la lee.
   - Prohibido guardar tokens (JWT, refresh, API keys) en `localStorage`, `sessionStorage`, stores persistidos o en el JS.
   - `apiFetch` ya envía `credentials: "include"`. Si la API está en otro origen, el backend debe permitir CORS con ese origen exacto y `Access-Control-Allow-Credentials: true` (nunca `*`).
2. **CSRF**: con cookies, el backend exige un token CSRF (cabecera, p. ej. `X-CSRF-Token`) o `SameSite=Strict` en las peticiones que cambian datos.
3. **Nada secreto en `VITE_*`**: Vite incrusta esas variables en el bundle. Solo valores públicos (URL de la API, client id público de OAuth).
4. **La SPA no autoriza**: ocultar un botón o una ruta es UX. El backend valida sesión y permisos en cada endpoint.
5. **HTML**: prohibido `v-html` con datos de la API o del usuario (un XSS roba la sesión aunque la cookie sea `HttpOnly`, actuando como el usuario).

## Patrón (orquestador: `src/lib/auth.ts` y el guard de `src/router/index.ts`)

```ts
// src/lib/auth.ts
import { z } from "zod";
import { apiFetch, ApiError } from "./api";

const meSchema = z.object({ id: z.string(), email: z.string(), roles: z.array(z.string()) });
export type Me = z.infer<typeof meSchema>;

/** Usuario actual o null si no hay sesión (401). Cualquier otro error se propaga. */
export async function getMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await apiFetch("/auth/me", meSchema, { signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function logout() {
  return apiFetch("/auth/logout", z.null(), { method: "POST" });
}
```

```ts
// src/router/index.ts — guard global: rutas con `meta: { requiresAuth: true }` redirigen a /login sin sesión.
// Es solo UX: la API rechaza igual sin sesión.
router.beforeEach(async (to) => {
  if (to.meta.requiresAuth && !(await getMe())) return { path: "/login", query: { next: to.fullPath } };
});
```

El login es un formulario que hace `POST /auth/login` con `apiFetch`; el backend responde con `Set-Cookie`. Después, vuelve a pedir `getMe()`.
