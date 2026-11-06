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
env_block() { # nombre contenido: reemplaza o agrega el bloque en .env.example (atómico; conserva sus permisos)
  local name=$1 body=$2 new tmp; new=$(mktemp)
  awk -v s="# >>> $name" -v e="# <<< $name" '$0==s{skip=1;next} $0==e{skip=0;next} !skip' .env.example > "$new"
  if [ -n "$body" ]; then printf '%s\n%s\n%s\n' "# >>> $name" "$body" "# <<< $name" >> "$new"; fi
  if cmp -s "$new" .env.example; then
    echo "  = .env.example [$name]"
  else
    # cp -p copia permisos (y dueño), cat cambia solo el contenido y mv reemplaza en un paso: nunca queda a medias.
    tmp=$(mktemp ./.env.example.XXXXXX); cp -p .env.example "$tmp"; cat "$new" > "$tmp"; mv "$tmp" .env.example
    echo "  ~ .env.example [$name]"
  fi
  rm -f "$new"
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
