# Decisión de base de datos

## ¿Hace falta base de datos?

**Sí** si se cumple cualquiera de estas condiciones:
- Hay usuarios propios (registro, login, perfiles). Better Auth, Sanctum o JWT con refresh necesitan tablas.
- Los usuarios crean o editan datos que deben sobrevivir a reinicios.
- Varios usuarios ven o modifican los mismos datos.
- Hace falta buscar, filtrar, reportar o auditar.

**No** (`--db none`) solo si se cumplen todas estas:
- Es un servicio sin estado: proxy, transformación, cálculo, webhook que reenvía.
- O el contenido viene de archivos o de un CMS externo.
- La identidad la gestiona por completo un IdP externo y no se guardan datos propios.

En caso de duda, la respuesta es sí: agregar una BD después cuesta más que tenerla desde el inicio.

## ¿Cuál?

| Opción | Elegir cuando | Evitar cuando |
|---|---|---|
| **PostgreSQL** (por defecto) | Casi siempre: relacional, transacciones, JSONB, búsqueda de texto, extensiones | — |
| **MySQL 8.4** | El hosting o el equipo ya lo usa (frecuente en PHP), o hay réplica existente | No hay una razón concreta: usa Postgres |
| **SQLite** | Prototipo, herramienta interna de una sola instancia, demo, escrituras poco concurrentes | Varias réplicas de la app, escrituras concurrentes, o stack Spring |
| **+ Redis** (`--redis`) | Caché, rate limiting, colas, sesiones a escala, locks distribuidos | Como base de datos principal |
| MongoDB / otras | Solo con una ADR que justifique el modelo documental; no hay overlay incluido | Datos relacionales (usuarios, pedidos, permisos) |

## Conexión por stack (las variables las inyecta el overlay)

| Stack | Variable que lee | ORM o migraciones |
|---|---|---|
| Next.js | `DATABASE_URL` | Prisma (`prisma migrate`) o Drizzle (`drizzle-kit`) |
| FastAPI | `DATABASE_URL` → convertir `postgresql://` a `postgresql+psycopg://` en `core/config.py` | SQLAlchemy 2 + Alembic |
| Laravel | `DB_CONNECTION`, `DB_HOST`, `DB_DATABASE`… (nativo) | Eloquent + migraciones |
| Spring | `SPRING_DATASOURCE_URL`, `..._USERNAME`, `..._PASSWORD` (nativo) | JPA + Flyway |

## Producción

- Para empezar, un VPS con el overlay es aceptable (volumen con nombre y backups, ver `docs/RUNBOOK.md`).
- Con datos críticos o más de un servidor: BD gestionada. En ese caso no copies `compose.db.yaml` al servidor y define la conexión en `.env.prod`.
- Registra la elección en una ADR que incluya la estrategia de backup.
