#!/usr/bin/env bash
# Activa la base de datos y/o Redis del proyecto. Sin red; idempotente; no sobrescribe overlays distintos.
# Uso: ver la variable usage (la única fuente del texto de ayuda).
set -euo pipefail
db=""; redis=0; force=0
usage="Uso: infra.sh --db postgres|mysql|sqlite|none [--redis] [--force]"
while [ $# -gt 0 ]; do
  case "$1" in
    --db) [ $# -ge 2 ] || { echo "$usage"; exit 2; }; db=$2; shift 2 ;;
    --redis) redis=1; shift ;;
    --force) force=1; shift ;;
    *) echo "$usage"; exit 2 ;;
  esac
done
case "$db" in postgres|mysql|sqlite|none) ;; *) echo "ERROR: --db debe ser postgres, mysql, sqlite o none"; exit 2 ;; esac
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f compose.yaml ] && [ -f .env.example ] || { echo "ERROR: falta compose.yaml o .env.example (¿proyecto creado con basekit?)"; exit 2; }
# A symlinked .env.example is updated through the link only when its target lives inside the project:
# checked before any change, so a refusal leaves everything as it was.
env_file=.env.example
if [ -L .env.example ]; then
  env_file=$(realpath .env.example)
  case "$env_file" in
    "$(pwd -P)"/*) ;;
    *) echo "ERROR: .env.example apunta fuera del proyecto ($env_file) y basekit no escribe fuera del proyecto."
       echo "       Copia ese archivo dentro del proyecto o agrega a mano los bloques de infra-setup."; exit 1 ;;
  esac
fi
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
mkdir -p .make

place() { # origen destino: + creado, ~ reemplazado (con --force), = sin cambios
  if [ -f "$2" ]; then
    if cmp -s "$1" "$2"; then echo "  = $2"; return; fi
    [ $force -eq 1 ] || { echo "ERROR: $2 ya existe con otro contenido (usa --force para reemplazarlo)"; exit 1; }
    cp "$1" "$2"; echo "  ~ $2"
  else
    cp "$1" "$2"; echo "  + $2"
  fi
}
# Temporary files of env_block, removed on any exit (also when cp, cat or mv fail under set -e).
ENV_NEW=""; ENV_TMP=""
trap 'rm -f "${ENV_NEW:-}" "${ENV_TMP:-}"' EXIT
env_block() { # nombre contenido: reemplaza o agrega el bloque en .env.example (atómico; conserva sus permisos)
  local name=$1 body=$2; ENV_NEW=$(mktemp)
  awk -v s="# >>> $name" -v e="# <<< $name" '$0==s{skip=1;next} $0==e{skip=0;next} !skip' .env.example > "$ENV_NEW"
  if [ -n "$body" ]; then printf '%s\n%s\n%s\n' "# >>> $name" "$body" "# <<< $name" >> "$ENV_NEW"; fi
  if cmp -s "$ENV_NEW" .env.example; then
    echo "  = .env.example [$name]"
  else
    # Se reemplaza el archivo real ($env_file: el destino del enlace, si lo es), así el enlace se conserva.
    # cp -p copia permisos (y dueño), cat cambia solo el contenido y mv reemplaza en un paso: nunca queda a medias.
    ENV_TMP=$(mktemp "$(dirname "$env_file")/.env.example.XXXXXX"); cp -p "$env_file" "$ENV_TMP"; cat "$ENV_NEW" > "$ENV_TMP"
    mv "$ENV_TMP" "$env_file"; ENV_TMP=""
    echo "  ~ .env.example [$name]"
  fi
  rm -f "$ENV_NEW"; ENV_NEW=""
}

if [ "$db" = none ]; then
  rm -f compose.db.yaml .make/db.mk; env_block db ""; echo "  - base de datos desactivada"
else
  place "$assets/compose.$db.yaml" compose.db.yaml
  case "$db" in
    postgres) env_block db $'DB_NAME=app\nDB_USER=app\nDB_PASSWORD=__GENERATE__'
              echo 'DB_SHELL_CMD = sh -c '\''psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'\''' > .make/db.mk ;;
    mysql)    env_block db $'DB_NAME=app\nDB_USER=app\nDB_PASSWORD=__GENERATE__\nDB_ROOT_PASSWORD=__GENERATE__'
              echo 'DB_SHELL_CMD = sh -c '\''mysql -u"$$MYSQL_USER" -p"$$MYSQL_PASSWORD" "$$MYSQL_DATABASE"'\''' > .make/db.mk ;;
    sqlite)   env_block db "# SQLite: archivo en el volumen app-data (/app/data/app.db)"; rm -f .make/db.mk ;;
  esac
fi
if [ $redis -eq 1 ]; then
  place "$assets/compose.redis.yaml" compose.redis.yaml; env_block redis 'REDIS_PASSWORD=__GENERATE__'
fi
for f in .env .env.prod; do
  [ -f "$f" ] && echo "AVISO: $f ya existe; ejecuta make env$([ "$f" = .env.prod ] && echo ' ENV=prod') para agregar solo las variables nuevas (no toca los secretos existentes)"
done
echo "infra OK: db=$db redis=$redis → siguiente: make env (si no existe) y make dev"
