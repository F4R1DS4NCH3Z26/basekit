# Auth en NestJS: JWT de acceso con guard global por controller

Dependencias, con aprobación del usuario (dentro de `make sh`, versión exacta y con al menos 14 días):

```bash
npm install --save-exact @nestjs/jwt @node-rs/argon2
```

`@node-rs/argon2` trae binarios precompilados (también para Alpine): no necesita compilador en la imagen.

## Variables (`.env.example`, ya incluidas)

`JWT_SECRET=__GENERATE__` (≥ 32 bytes aleatorios; `make env` lo genera), `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES=15`.

## `src/common/auth/auth.config.ts` (orquestador)

```ts
// Falla al arrancar si falta un secreto: nunca un valor por defecto para JWT_SECRET.
export function authConfig() {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres (make env)');
  return {
    secret,
    issuer: process.env.JWT_ISSUER ?? 'app',
    audience: process.env.JWT_AUDIENCE ?? 'app-clients',
    expiresInSeconds: Number(process.env.ACCESS_TOKEN_MINUTES ?? 15) * 60,
  };
}
```

## `src/common/auth/jwt-auth.guard.ts` (orquestador)

```ts
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from './auth.config.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    const { secret, issuer, audience } = authConfig();
    try {
      // algorithms fijado: rechaza tokens "none" o firmados con otro algoritmo.
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret, issuer, audience, algorithms: ['HS256'] });
      req.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException(); // sin detalles: expirado, firma o formato dan la misma respuesta
    }
  }
}
```

## `src/common/auth/current-user.decorator.ts` (orquestador)

```ts
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export type AuthUser = { id: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
```

## `src/common/auth/auth.module.ts` (orquestador; se importa en `AppModule`)

```ts
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Global()
@Module({ imports: [JwtModule.register({})], providers: [JwtAuthGuard], exports: [JwtModule, JwtAuthGuard] })
export class AuthModule {}
```

## Módulo `users` / `auth` (lo crean los writers con `nest-scaffold`)

- **Registro**: `hash(password)` de `@node-rs/argon2` (argon2id). Contraseña con `z.string().min(12).max(128)`; email normalizado (`trim().toLowerCase()`). Email duplicado → respuesta genérica.
- **Login**: `verify(hash, password)`; si el usuario no existe, verifica igual contra un hash fijo (mismo tiempo de respuesta). Error único: "Credenciales inválidas" (401).
- **Token**: `jwt.signAsync({ sub: user.id }, { secret, issuer, audience, expiresIn: expiresInSeconds, algorithm: 'HS256' })`. Nunca metas email, rol o PII en el payload si no hace falta.
- **Rate limit** en login y registro: `@nestjs/throttler` (con Redis si hay varias instancias).
- Refresh tokens rotados (tabla con hash del token, `expiresAt`, `revokedAt`) solo si el contrato los pide; documéntalo en `docs/AUTH.md` y en una ADR.

## Protección (defensa en capas)
- `@UseGuards(JwtAuthGuard)` en cada controller que exija sesión (o en el método).
- Autorización por recurso en el **service**: busca siempre con `{ id, ownerId: user.id }`; ajeno → 404.
- CORS solo con `CORS_ORIGINS` (ya en `src/main.ts`); en prod, la URL real con https.
