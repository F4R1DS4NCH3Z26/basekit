# Auth en Express con JWT propio

API sin estado: el cliente envía `Authorization: Bearer <token>`. Dependencia, con aprobación del usuario: `make deps-add PKGS="jose@6"` (versión exacta, publicada hace al menos 14 días). Las contraseñas, si la API las guarda, con `argon2` (`make deps-add PKGS="argon2@0"`), nunca con un hash rápido.

## 1. `src/lib/auth.ts` (orquestador)

```ts
import type { NextFunction, Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { env } from "./env.js";

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

/** Middleware: 401 sin token válido. Deja el usuario en res.locals.user. */
export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    // algorithms fijo: rechaza "none" y la confusión de algoritmos.
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string") throw new Error("sin sub");
    res.locals.user = { id: payload.sub, role: String(payload.role ?? "user") } satisfies AuthUser;
    next();
  } catch {
    res.status(401).json({ error: "No autorizado" }); // sin detalles: no ayuda a probar tokens
  }
}

/** Usuario autenticado (solo después de requireUser). */
export function currentUser(res: Response): AuthUser {
  return res.locals.user as AuthUser;
}

/** Autorización por rol, después de requireUser. */
export function requireRole(role: string) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (currentUser(res).role !== role) return void res.status(403).json({ error: "Prohibido" });
    next();
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
- Detrás de un proxy con TLS: `app.set("trust proxy", 1)` en `src/app.ts`, para que la IP y el protocolo sean los reales.

## 4. Tests (qa-writer)
`tests/helpers/auth.ts` firma tokens de prueba con `signAccessToken` y un `JWT_SECRET` de prueba (`vi.stubEnv` antes de importar la app, o el `.env` de dev).

## Variables (`.env.example`)
`JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES`. `src/lib/env.ts` valida que `JWT_SECRET` tenga al menos 32 caracteres.
