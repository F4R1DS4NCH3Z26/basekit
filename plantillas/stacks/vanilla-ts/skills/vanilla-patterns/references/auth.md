# Auth en una SPA TypeScript sin framework (el backend es el dueño de la sesión)

Una SPA no guarda secretos: todo su código es público. La autenticación la hace el backend; la SPA solo la refleja.

## Reglas
1. **Sesión en una cookie `HttpOnly`, `Secure` y `SameSite=Lax` (o `Strict`)** que pone el backend. La SPA nunca la lee.
   - Prohibido guardar tokens (JWT, refresh, API keys) en `localStorage`, `sessionStorage`, stores o en el JS.
   - `apiFetch` ya envía `credentials: "include"`. Si la API está en otro origen, el backend debe permitir CORS con ese origen exacto y `Access-Control-Allow-Credentials: true` (nunca `*`).
2. **CSRF**: con cookies, el backend exige un token CSRF (cabecera, p. ej. `X-CSRF-Token`) o `SameSite=Strict` en las peticiones que cambian datos.
3. **Nada secreto en `VITE_*`**: Vite incrusta esas variables en el bundle. Solo valores públicos (URL de la API, client id público de OAuth).
4. **La SPA no autoriza**: ocultar un botón o una ruta es UX. El backend valida sesión y permisos en cada endpoint.
5. **HTML**: prohibido `innerHTML`, `outerHTML`, `insertAdjacentHTML` y `document.write` (ESLint los rechaza). Un XSS roba la sesión aunque la cookie sea `HttpOnly`, actuando como el usuario. Construye con `h()`.
6. **URLs de datos**: un `href` o `src` que viene de la API o del usuario se valida antes de usarlo (`new URL(v)` y protocolo `https:`); nunca `javascript:`.

## Patrón (orquestador: `src/lib/auth.ts`; el guard de ruta en `src/routes.ts`)

```ts
// src/lib/auth.ts
import { z } from "zod";
import { apiFetch, ApiError } from "./api";

const meSchema = z.object({ id: z.string(), email: z.string(), roles: z.array(z.string()) });
export type Me = z.infer<typeof meSchema>;

/** Usuario actual o null si no hay sesión (401). Cualquier otro error se propaga. */
export async function getMe(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await apiFetch("/auth/me", meSchema.parse, { signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function logout() {
  return apiFetch("/auth/logout", z.null().parse, { method: "POST" });
}
```

```ts
// src/routes.ts: una página protegida envuelve a otra. Es solo UX: la API rechaza igual sin sesión.
import { navigate, type Page } from "./lib/router";
import { getMe } from "./lib/auth";

const requireSession = (page: Page): Page => async (ctx) => {
  if (!(await getMe(ctx.signal))) { navigate("/login", { replace: true }); return document.createComment("login"); }
  return page(ctx);
};
// "/products": requireSession(productsPage),
```

El login es un formulario que hace `POST /auth/login` con `apiFetch`; el backend responde con `Set-Cookie`. Después, vuelve a pedir `getMe()`.
