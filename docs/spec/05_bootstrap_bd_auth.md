# 05 · Bootstrap: del "trata de…" a la base funcionando

El usuario solo describe el proyecto. Lo demás lo hace el agente con la skill `project-bootstrap` (`plantillas/skills/project-bootstrap/`), apoyado en las skills de Matt Pocock.

## 1. Disparador

`AGENTS.md` lo dice en las primeras líneas, para que funcione incluso en herramientas sin skills:

> Si `docs/PROJECT.md` dice `Estado: sin definir`, no escribas código de negocio: ejecuta el bootstrap.

Prompt sugerido al usuario (lo imprime el CLI):

> «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: <una o dos frases>»

Alternativa: el usuario invoca `/grill-with-docs` primero, y el bootstrap continúa cuando la entrevista termina.

## 2. Pasos de la skill

| Paso | Qué hace el agente | Resultado |
|---|---|---|
| 1 · Entrevista | Aplica `grilling` + `domain-modeling` (rondas numeradas, siempre con una respuesta recomendada; los hechos los busca el agente, las decisiones son del usuario) | Entendimiento compartido confirmado |
| 2 · Documentar | Rellena `docs/PROJECT.md` (pasa a `Estado: definido`), `GLOSSARY.md`, al menos 2 ADR (BD y auth), `docs/AUTH.md` y `docs/ARCHITECTURE.md` (con mermaid) | Decisiones trazables |
| 3 · Infraestructura | `infra.sh --db … [--redis]` → `make new-app` (si falta la app) → `make env && make dev` | La app responde en local |
| 4 · Auth | Pide aprobación de dependencias → núcleo de auth (zona del orquestador) → módulo de usuarios con scaffold y roles | Login funcionando y probado |
| 5 · Módulos v1 | Scaffold + contrato cerrado con el usuario + delegación por roles (o solo los contratos, si el usuario lo prefiere) | Features base |
| 6 · Cierre | `make verify && make test` + `zone-check --owners` + `README.md` actualizado | Resumen con enlaces a las ADR y lo pendiente |

Ramas **obligatorias** del árbol de la entrevista:
- Actores y roles.
- Alcance de la v1 y no-objetivos.
- Datos (→ BD).
- Identidad y clientes (→ auth).
- Integraciones y sus secretos.
- Despliegue (VPS con Compose o plataforma gestionada; ¿BD gestionada?).
- 3–5 módulos iniciales.

## 3. ¿Hace falta base de datos? (resumen de `references/database.md`)

**Sí**, si se cumple cualquiera de estas condiciones:
- Hay usuarios propios.
- Hay datos creados por usuarios que deben persistir.
- Hay colaboración, búsqueda, reportes o auditoría.

**No**, solo si el servicio no tiene estado, el contenido es externo **y** la identidad la gestiona por completo un IdP externo.

En caso de duda: sí.

| Motor | Cuándo |
|---|---|
| **PostgreSQL** (por defecto) | Casi siempre |
| MySQL 8.4 | El hosting o el equipo ya lo usa |
| SQLite | Prototipos y herramientas de una sola instancia (no con Spring) |
| Ninguna | Los stacks frontend (React, Vue, TypeScript + Vite): no tienen base de datos; los datos y la auth viven en el backend |
| + Redis | Caché, rate limit, colas o sesiones; nunca como BD principal |
| Otros | Solo con ADR; no hay overlay incluido |

## 4. Autenticación (resumen de `references/auth.md`)

| Stack | Por defecto | Móvil / terceros | IdP corporativo |
|---|---|---|---|
| Next.js | **Better Auth** (sesión en BD, cookie `httpOnly`) | Plugin `bearer` o `jwt` | Plugin SSO u OIDC |
| FastAPI | **JWT propio**: access de 15 min + refresh opaco rotado con detección de reutilización | El mismo JWT | Validar los JWT del IdP |
| Laravel | **Sanctum** (cookie para SPA) + Fortify | Tokens de Sanctum con expiración | Socialite u OIDC |
| Spring | **Spring Security + JWT** (resource server con emisor propio) | El mismo JWT | `issuer-uri` del IdP |
| Django | **SimpleJWT**: access + refresh rotado con lista negra; `User(AbstractUser)` propio antes de la primera migración | El mismo JWT | — (con ADR) |
| Django + HTMX | **Sesión de Django** (`LoginView`/`LogoutView` incluidos, cookie `HttpOnly` + `SameSite=Lax`, CSRF) | — (con ADR) | — (con ADR) |
| Flask, Python nativo | **JWT propio**: access + refresh rotado (`pyjwt` + `pwdlib[argon2]`) | El mismo JWT | — (con ADR) |
| NestJS | **JWT** (`@nestjs/jwt`, `JwtAuthGuard` con HS256 fijo, `iss` y `aud`) + argon2id | El mismo JWT | — (con ADR) |
| Express, Node nativo | **JWT propio** (`jose`, `requireUser` con HS256 fijo, `iss` y `aud`); refresh solo si el contrato lo pide | El mismo JWT | — (con ADR) |
| Symfony | **Access tokens** opacos (se guarda su sha256, con expiración) en el firewall `main`, sin estado | El mismo token | — (con ADR) |
| PHP nativo | **Tokens opacos** (sha256 en `access_tokens`, límite de intentos); toda ruta exige auth salvo `public: true` | El mismo token | — (con ADR) |
| Gin, Go nativo | **JWT propio**: access corto + refresh rotado por familia (`golang-jwt/jwt/v5`) | El mismo JWT | — (con ADR) |
| React, Vue, TypeScript + Vite | **La SPA no autentica**: el backend pone una cookie `HttpOnly` y valida cada endpoint; `credentials: "include"`, nunca tokens en `localStorage` | Lo resuelve el backend | Lo resuelve el backend |

Reglas comunes:
- Contraseñas con argon2id o bcrypt.
- JWT con algoritmo fijo, validación de `iss`, `aud` y `exp`, y secreto de al menos 256 bits.
- Refresh rotado y guardado con hash.
- Cookies `httpOnly`, `Secure` y `SameSite`; nunca tokens en `localStorage`.
- Rate limit en el login.
- Errores genéricos y tiempo constante, para no revelar si un usuario existe.
- Autorización por recurso en servicios o acciones, no solo en el middleware.

"Sin auth" solo es válido con una ADR que lo justifique.

La implementación de cada stack está en `plantillas/stacks/<s>/skills/<x>-patterns/references/auth.md`, y el resumen en `docs/stacks/<s>.md`.

## 5. Documentación resultante (convenciones de `domain-modeling`)

| Archivo | Contenido | Quién lo mantiene |
|---|---|---|
| `README.md` | Requisitos, arranque en 4 comandos, producción, enlaces | Orquestador |
| `docs/PROJECT.md` | Qué es, actores, alcance, no-objetivos, decisiones base, módulos | Bootstrap y orquestador |
| `GLOSSARY.md` (raíz) | Términos del dominio, sin detalles de implementación; formato `**Término**:` + `_Avoid_:` | `domain-modeling`, que lo crea al resolver el primer término |
| `docs/adr/NNNN-slug.md` | 1–3 frases: contexto, decisión y por qué. Solo si es difícil de revertir, sorprendente **y** fruto de un trade-off real | `domain-modeling` + bootstrap (BD y auth siempre) |
| `docs/ARCHITECTURE.md` | Diagrama mermaid, módulos, integraciones | Orquestador |
| `docs/AUTH.md` | Método, flujos, roles y medidas aplicadas | Bootstrap |
| `docs/RUNBOOK.md` | Entornos, despliegue, secretos, backups, incidentes | Orquestador |
| `docs/specs/<m>_contract.md` | Contrato por módulo (sección por rol) | Orquestador con el usuario |

Regla de `AGENTS.md`: **la documentación se actualiza en el mismo cambio que el código**.

## 6. Ejemplo de sesión (abreviado)

```text
Usuario: Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de reservas de canchas de pádel para clubes.

Agente (ronda 1):
❓ Q1 · Actores: ¿socios que reservan, administradores del club y un superadmin de la plataforma?
➡️ Sí, con multi-club desde la v1.
❓ Q2 · Datos: reservas, canchas, horarios y pagos persisten y se consultan por fecha.
➡️ PostgreSQL. ¿Redis para bloquear el slot mientras se paga?
❓ Q3 · Clientes: ¿web responsive o también app móvil en la v1?
➡️ Solo web (Next.js). Better Auth con email + Google; móvil, más adelante con el plugin bearer.
…
Agente (cierre): ADR 0001 (PostgreSQL + Redis para locks), 0002 (Better Auth), 0003 (multi-tenant por club_id).
make dev → http://localhost:3000 ✔ · Pendiente: pasarela de pagos (ADR abierta).
```
