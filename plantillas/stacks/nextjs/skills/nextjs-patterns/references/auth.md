# Auth en Next.js con Better Auth

Requiere base de datos (Better Auth guarda usuarios, sesiones y cuentas). Dependencias, con aprobación del usuario: `better-auth`, más el ORM (`prisma` + `@prisma/client`, o `drizzle-orm`).

## 1. Servidor — `src/lib/auth.ts` (orquestador)

```ts
import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }), // "mysql" | "sqlite" según la ADR
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  rateLimit: { enabled: true, window: 60, max: 20 },
  // socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } },
  plugins: [nextCookies()], // siempre el último
});

/** Sesión actual o null. Úsala en Server Components, Server Actions y route handlers. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Para páginas protegidas: redirige a /login si no hay sesión. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}
```

`src/lib/env.ts` valida `BETTER_AUTH_SECRET` (mínimo 32 caracteres) y `BETTER_AUTH_URL` (URL) con Zod al arrancar.

## 2. Handler — `src/app/api/auth/[...all]/route.ts` (data-writer)

```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

## 3. Cliente — `src/lib/auth-client.ts` (orquestador)

```ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient(); // misma URL de origen
// uso: authClient.signIn.email({ email, password }), authClient.signUp.email(...), authClient.signOut()
```

## 4. Esquema de BD

Genera las tablas de Better Auth con su CLI **dentro de Docker** y revisa el diff antes de migrar:

```bash
make sh            # dentro: npx --no-install @better-auth/cli generate   (agrega modelos a prisma/schema.prisma)
make migration NAME=better_auth && make migrate
```

## 5. Protección (defensa en capas)
- **Middleware** (`src/middleware.ts`, o `proxy.ts` en Next 16+): solo un chequeo optimista de la cookie para redirigir rápido, con `getSessionCookie(request)` de `better-auth/cookies`. **No es seguridad.**
- **Páginas**: `await requireUser()` al inicio del Server Component.
- **Server Actions y route handlers**: `const session = await getSession(); if (!session) return { ok: false, error: "No autorizado" };`, y luego autorización por recurso (dueño o rol).

## 6. Si hay app móvil o API para terceros
Activa el plugin `bearer()` (sesión por header `Authorization`) o el plugin `jwt()` (JWKS para que otros servicios validen). Documenta el cambio en `docs/AUTH.md` y en una ADR.

## Variables (`.env.example`)
`BETTER_AUTH_SECRET=__GENERATE__`, `BETTER_AUTH_URL=` (en prod, la URL pública con https). Si usas proveedores sociales: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.
