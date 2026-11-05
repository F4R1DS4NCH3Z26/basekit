# Decisión de autenticación

## Preguntas que la deciden
1. ¿Quién inicia sesión? (público general, empleados, otros servicios)
2. ¿Desde qué clientes? (web renderizada en servidor, SPA en otro dominio, app móvil, API para terceros)
3. ¿Hace falta login social, SSO corporativo (OIDC/SAML), MFA u organizaciones o equipos?
4. ¿Ya existe un proveedor de identidad (Google Workspace, Entra ID, Keycloak, Auth0)?

## Recomendación por stack

| Stack | Por defecto | Si hay móvil o API para terceros | Si hay IdP corporativo o SSO |
|---|---|---|---|
| **Next.js** | **Better Auth**: sesión en BD con cookie `httpOnly`; email y contraseña; social y 2FA por plugins | Plugin `bearer` o `jwt` de Better Auth | Plugin SSO de Better Auth u OIDC del IdP |
| **FastAPI** | **JWT propio**: access de 15 min + refresh opaco rotado y guardado con hash; cookie `httpOnly` si el cliente es navegador | El mismo JWT por header `Authorization` | Validar los JWT del IdP (resource server) sin guardar contraseñas |
| **Laravel** | **Sanctum**: cookie de sesión para SPA del mismo dominio y Breeze o Fortify para los flujos | Tokens de Sanctum con expiración y abilities | Socialite (social) o un paquete OIDC; Passport solo si **eres** un servidor OAuth2 |
| **Spring** | **Spring Security + JWT** (resource server con emisor propio, HS256) | El mismo JWT | Resource server apuntando al `issuer-uri` del IdP (Keycloak, etc.) |

La implementación concreta está en la skill del stack, en `<stack>-patterns/references/auth.md`.

"Sin autenticación" solo es válido con una ADR que lo justifique (por ejemplo, un servicio interno detrás de un gateway que ya autentica).

## Reglas comunes (no negociables)
- Contraseñas con **argon2id** (o bcrypt de coste ≥ 12). Longitud mínima de 12 y sin máximo bajo.
- **JWT**:
  - Algoritmo fijo en la verificación (nunca aceptar `none`).
  - Validar `exp`, `iss` y `aud`.
  - Secreto de ≥ 256 bits desde el entorno (`__GENERATE__`).
  - Sin datos personales en el payload.
  - Access de 15 min o menos.
- **Refresh tokens**: opacos y aleatorios, guardados con hash. Se rotan en cada uso, y si se reutiliza uno ya rotado se revoca toda la familia. El logout también los revoca.
- **En el navegador**: cookies `httpOnly`, `Secure` (en prod) y `SameSite=Lax`, más protección CSRF si la sesión va en cookie. Nunca guardes tokens en `localStorage`.
- **Login**:
  - Rate limit por IP y por cuenta.
  - Mensaje genérico ("credenciales inválidas") que no revele si el usuario existe.
  - El mismo tiempo de respuesta exista o no el usuario.
- **Autorización por recurso** en la capa de servicio o acciones (dueño o rol), no solo en el middleware.
- Toda variable nueva va a `.env.example`. Todo el flujo se documenta en `docs/AUTH.md`.
