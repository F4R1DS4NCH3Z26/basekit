#!/usr/bin/env bash
# Agrega la extensión PECL mongodb (fijada) al Dockerfile cuando el overlay que activó infra-setup es MongoDB
# (compose.db.yaml con DB_DRIVER: mongodb): Doctrine MongoDB ODM la necesita. Lo ejecuta `make new-app` antes de crear
# la app (la configuración del ODM la escribe .make/symfony/setup.php config-mongo); con otra BD o sin BD no hace nada.
# Idempotente. Nunca pisa un Dockerfile que cambiaste: si no tiene la línea del kit, se detiene sin cambiar nada.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"

# Same exact match as scaffold.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
[ "$driver" = mongodb ] || exit 0

# PECL mongodb 2.5.5 (2026-10-15): exact and at least 14 days old; mongodb/mongodb 2.5 (stack.mk) needs ext-mongodb ^2.5.
EXT_MONGODB_VERSION=2.5.5
starter_ext='RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache redis \'
mongo_ext="RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache redis mongodb-$EXT_MONGODB_VERSION \\"

if grep -Eq '^RUN install-php-extensions .*[[:space:]]mongodb(-[0-9.]+)?([[:space:]]|$)' Dockerfile 2>/dev/null; then
  echo "  = Dockerfile"
elif [ -f Dockerfile ] && grep -qxF "$starter_ext" Dockerfile; then
  # mktemp + mv: never half written; chmod 644 because mktemp creates 0600 files.
  tmp=$(mktemp Dockerfile.XXXXXX)
  # ENVIRON, not awk -v: -v processes escapes, and gawk drops the line's trailing backslash, so nothing would match.
  S="$starter_ext" M="$mongo_ext" awk '$0 == ENVIRON["S"] { print ENVIRON["M"]; next } { print }' Dockerfile > "$tmp"
  grep -qxF "$mongo_ext" "$tmp" || { rm -f "$tmp"; echo "ERROR: no se pudo agregar mongodb-$EXT_MONGODB_VERSION al Dockerfile"; exit 1; }
  chmod 644 "$tmp"; mv "$tmp" Dockerfile
  echo "  ~ Dockerfile (extensión mongodb-$EXT_MONGODB_VERSION)"
else
  echo "ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca."
  echo "       Agrega mongodb-$EXT_MONGODB_VERSION a install-php-extensions y vuelve a ejecutar make new-app."
  exit 2
fi
echo "mongo-setup OK: MongoDB (Doctrine MongoDB ODM)"
