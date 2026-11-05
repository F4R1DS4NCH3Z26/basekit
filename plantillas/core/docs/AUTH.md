# Autenticación y autorización

Estado: pendiente   <!-- el bootstrap lo completa según la ADR de auth -->

## Método elegido
<!-- Better Auth / JWT propio / Sanctum / Spring Security + JWT / OIDC externo, con su ADR -->

## Flujos
| Flujo | Endpoint o ruta | Notas |
|---|---|---|
| Registro | | |
| Login | | |
| Refresh / renovación | | |
| Logout / revocación | | |

## Roles y permisos
| Rol | Puede |
|---|---|

## Reglas de seguridad aplicadas
- Hash de contraseñas: argon2id o bcrypt.
- Tokens o cookies: duración, `httpOnly`, `Secure`, `SameSite`.
- Rate limit en login y en la recuperación de contraseña.
- Mensajes de error que no revelan si un usuario existe.
