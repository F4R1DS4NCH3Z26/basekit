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
- El bloque de basekit en `.gitignore` ignora **todo** archivo `.env*` y solo deja en git `.env.example`, `.env.sample` y `.env.template`: cualquier otra variante (`.env.staging`, un `.bak`) puede tener secretos. Si tu framework versiona archivos sin secretos como `.env.development` o `.env.test`, vuelve a incluirlos **debajo** del bloque (git aplica la última regla que coincide): `!.env.development`.
- Para rotarlos: edita `.env.prod`, ejecuta `make prod-up` y, si cambia el secreto de auth, todas las sesiones se invalidan.

## Base de datos
- Backup: <completar según el motor; ej. con PostgreSQL en producción, con los mismos archivos que usa `make ENV=prod`: `docker compose --env-file .env.prod -f compose.yaml -f compose.prod.yaml -f compose.db.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql`. `make -n ps ENV=prod` muestra el comando exacto de tu proyecto>
- Restauración: <completar>
- En producción, valora una base de datos gestionada; en ese caso elimina `compose.db.yaml` del servidor y define la conexión en `.env.prod`.

## Incidentes frecuentes
| Síntoma | Causa probable | Acción |
|---|---|---|
