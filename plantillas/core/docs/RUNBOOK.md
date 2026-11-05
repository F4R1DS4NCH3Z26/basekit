# Runbook (operación)

## Entornos
| Entorno | Comando | Archivo de entorno | Compose |
|---|---|---|---|
| dev | `make dev` | `.env` | `compose.yaml` + `compose.dev.yaml` + overlays |
| prod | `make prod-up` | `.env.prod` | `compose.yaml` + `compose.prod.yaml` + overlays |

## Despliegue
1. `git pull` en el servidor (o descarga de la imagen desde tu registry).
2. `make prod-up`
3. `make prod-migrate`
4. `make prod-logs` y revisa el healthcheck: `make ps ENV=prod`.

## Secretos
- Se generan con `make env [ENV=prod]`. Nunca se commitean (`.gitignore`).
- Para rotarlos: edita `.env.prod`, ejecuta `make prod-up` y, si cambia el secreto de auth, todas las sesiones se invalidan.

## Base de datos
- Backup: <completar según el motor; ej. `docker compose exec db pg_dump -U app app > backup.sql`>
- Restauración: <completar>
- En producción, valora una base de datos gestionada; en ese caso elimina `compose.db.yaml` del servidor y define la conexión en `.env.prod`.

## Incidentes frecuentes
| Síntoma | Causa probable | Acción |
|---|---|---|
