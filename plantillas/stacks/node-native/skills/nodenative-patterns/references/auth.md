# Auth en la API Node nativa con JWT propio

API sin estado: el cliente envía `Authorization: Bearer <token>`. Dependencia, con aprobación del usuario: `make deps-add PKGS="jose@6"` (versión exacta, publicada hace al menos 14 días). Las contraseñas, si la API las guarda, con `argon2` (`make deps-add PKGS="argon2@0"`), nunca con un hash rápido.

## 1. `src/lib/auth.ts` (orquestador)

```ts
import { jwtVerify, SignJWT } from "jose";
import { env } from "./env.js";
import type { Context, Handler } from "./router.js";

export type AuthUser = { id: string; role: string };

function secret(): Uint8Array {
  if (!env.JWT_SECRET) throw new Error("Falta JWT_SECRET (make env)");
  return new TextEncoder().encode(env.JWT_SECRET);
}

/** Emite un access token corto. Lo llama el endpoint de login tras verificar la contraseña. */
export async function signAccessToken(user: AuthUser): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_MINUTES}m`)
    .sign(secret());
}

/** Middleware: 401 sin token válido. Deja el usuario en ctx.locals.user. */
export const requireUser: Handler = async (ctx, next) => {
  const header = ctx.req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  let user: AuthUser;
  try {
    // algorithms fijo: rechaza "none" y la confusión de algoritmos.
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string") throw new Error("sin sub");
    user = { id: payload.sub, role: String(payload.role ?? "user") };
  } catch {
    return ctx.json(401, { error: "No autorizado" }); // sin detalles: no ayuda a probar tokens
  }
  ctx.locals.user = user;
  await next(); // fuera del try: un error del handler no se convierte en 401
};

/** Usuario autenticado (solo después de requireUser). */
export function currentUser(ctx: Context): AuthUser {
  return ctx.locals.user as AuthUser;
}

/** Autorización por rol, después de requireUser. */
export function requireRole(role: string): Handler {
  return async (ctx, next) => {
    if (currentUser(ctx).role !== role) return ctx.json(403, { error: "Prohibido" });
    await next();
  };
}
```

## 2. Login (módulo `auth`, web-writer + logic-writer)

Modelo (orquestador, `prisma/schema.prisma`; después `make migration NAME=create_users` y `make migrate`):

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         String   @default("user")
  createdAt    DateTime @default(now())
}
```

El `repository.ts` del módulo lee el usuario con `db()` de `src/lib/db.ts` (Prisma 7, adaptador de la BD activa) y un `select` explícito: `passwordHash` solo en la consulta del login, nunca en una respuesta.

- `POST /auth/login` con `loginSchema` (`email`, `password`, `.strict()`). El service busca el usuario, compara con `argon2.verify` y devuelve el token; si falla, el mismo error para "no existe" y "contraseña incorrecta".
- Limita los intentos (por IP y por email): con Redis (`REDIS_URL` del overlay) o, en una sola instancia, en memoria. Documenta la decisión en una ADR.
- Refresh tokens: solo si el contrato los pide. Guárdalos hasheados en la BD, con rotación y revocación.

## 3. Defensa en capas
- `requireUser` en el router del módulo (o por ruta). Nunca confíes en un `userId` del body o de la query.
- Autorización por recurso en `services.ts` (dueño o rol): un recurso ajeno responde 404.
- IP del cliente: `ctx.req.socket.remoteAddress`. Detrás de un proxy con TLS, lee `X-Forwarded-For` solo si el proxy es tuyo y la reescribe (si no, la IP es falsificable); documenta la decisión en una ADR.

## 4. Tests (qa-writer)
`tests/helpers/auth.ts` firma tokens de prueba con `signAccessToken` y un `JWT_SECRET` de prueba (`vi.stubEnv` antes de importar la app, o el `.env` de dev).

## Variables (`.env.example`)
`JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES`. `src/lib/env.ts` valida que `JWT_SECRET` tenga al menos 32 caracteres.
