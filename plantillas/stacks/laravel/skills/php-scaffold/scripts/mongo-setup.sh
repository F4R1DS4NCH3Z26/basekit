#!/usr/bin/env bash
# Pasa la app Laravel a MongoDB con mongodb/laravel-mongodb cuando el overlay que activó infra-setup es MongoDB
# (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` después de crear la app; con otra BD o sin BD no
# hace nada. Idempotente: lo que ya tiene la variante MongoDB se conserva. Nunca pisa un archivo que cambiaste: si no
# reconoce el original, se detiene sin cambiar nada y dice qué agregar a mano.
# Para pasar a MongoDB después de make new-app: activa la BD con infra-setup y vuelve a ejecutar este script.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"

# Same exact match as scaffold.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
[ "$driver" = mongodb ] || exit 0

[ -f artisan ] && [ -f composer.json ] && [ -f config/database.php ] || {
  echo "ERROR: ejecútalo en una app Laravel creada (faltan artisan, composer.json o config/database.php; ¿make new-app?)"; exit 2; }

# Exact versions (repo rule), each at least 14 days old. The PECL extension goes in the image (Dockerfile) and, as a
# platform package, in composer.json: the composer:2 image that resolves the lock does not have it.
LARAVEL_MONGODB_VERSION=5.12.0   # mongodb/laravel-mongodb (2026-10-26)
MONGODB_LIB_VERSION=2.5.0        # mongodb/mongodb (2026-09-29), pinned so the lock never takes a younger driver
EXT_MONGODB_VERSION=2.5.5        # PECL mongodb (2026-10-15); mongodb/mongodb 2.5 needs ext-mongodb ^2.5

# The starter's extension line: only this exact line is changed. Any other Dockerfile is the user's.
starter_ext='RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache bcmath pcntl redis \'
mongo_ext="RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache bcmath pcntl redis mongodb-$EXT_MONGODB_VERSION \\"
stubs_dir=stubs

# The connection: MONGO_URL is the app user's URL that the overlay injects (authSource = DB_NAME).
connection=$(cat <<'PHP'
        // MongoDB (mongodb/laravel-mongodb). MONGO_URL la inyecta el overlay de BD (compose.db.yaml) con el usuario de la app.
        'mongodb' => [
            'driver' => 'mongodb',
            'dsn' => env('MONGO_URL'),
            'database' => env('DB_DATABASE', 'app'),
        ],
PHP
)

# make migration (php artisan make:migration) uses stubs/migration*.stub when they exist: in MongoDB a migration
# creates a collection's indexes, and down() drops only those indexes, never the collection or its documents.
stub() { # $1 = up body, $2 = down body
  cat <<PHP
<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use MongoDB\Laravel\Schema\Blueprint;

// MongoDB: sin esquema de tabla. La migración crea los índices de la colección (make migrate) y down() quita solo
// esos índices, nunca la colección ni sus documentos.
return new class extends Migration
{
    public function up(): void
    {
$1
    }

    public function down(): void
    {
$2
    }
};
PHP
}
table_up="        Schema::table('{{ table }}', function (Blueprint \$collection): void {
            // \$collection->index('owner_id');
            // \$collection->unique('email');
        });"
table_down="        Schema::table('{{ table }}', function (Blueprint \$collection): void {
            // \$collection->dropIndex(['owner_id']);
            // \$collection->dropIndex(['email']);
        });"
blank="        //"
stub_for() {
  case "$1" in
    migration.stub) stub "$blank" "$blank" ;;
    *) stub "$table_up" "$table_down" ;;
  esac
}

# 1. Check everything first: on any refusal nothing has been changed.
docker_action=keep
if grep -Eq '^RUN install-php-extensions .*[[:space:]]mongodb(-[0-9.]+)?([[:space:]]|$)' Dockerfile 2>/dev/null; then :
elif [ -f Dockerfile ] && grep -qxF "$starter_ext" Dockerfile; then docker_action=change
else
  echo "ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca."
  echo "       Agrega mongodb-$EXT_MONGODB_VERSION a install-php-extensions y vuelve a ejecutar este script."
  exit 2
fi
db_action=keep
if ! grep -q "'driver' => 'mongodb'" config/database.php; then
  [ "$(grep -c "^    'connections' => \[\$" config/database.php || true)" = 1 ] || {
    echo "ERROR: config/database.php no tiene una sola línea \"    'connections' => [\"; no se toca."
    echo "       Agrega a mano la conexión 'mongodb' (driver mongodb, dsn env('MONGO_URL'), database env('DB_DATABASE'))."
    exit 2; }
  db_action=add
fi
stubs_new=()
for s in migration.stub migration.create.stub migration.update.stub; do
  if [ ! -e "$stubs_dir/$s" ]; then stubs_new+=("$s")
  elif ! cmp -s <(stub_for "$s") "$stubs_dir/$s"; then
    echo "ERROR: $stubs_dir/$s ya existe con otro contenido; no se pisa."
    echo "       Bórralo (o muévelo) si quieres el stub de MongoDB y vuelve a ejecutar este script."
    exit 2
  fi
done

# write <ruta>: stdin → ruta en un paso (mktemp + mv); chmod 644 because mktemp creates 0600 files.
write() { local tmp; mkdir -p "$(dirname "$1")"; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; }

# 2. Apply.
if [ $docker_action = change ]; then
  awk -v s="$starter_ext" -v m="$mongo_ext" '$0 == s { print m; next } { print }' Dockerfile | write Dockerfile
  echo "  ~ Dockerfile (extensión mongodb-$EXT_MONGODB_VERSION)"
else echo "  = Dockerfile"; fi
if [ $db_action = add ]; then
  CONN="$connection" awk '{ print } $0 == "    '"'"'connections'"'"' => [" { print ""; print ENVIRON["CONN"] }' config/database.php \
    | write config/database.php
  echo "  ~ config/database.php (conexión mongodb)"
else echo "  = config/database.php"; fi
for s in migration.stub migration.create.stub migration.update.stub; do
  if [[ " ${stubs_new[*]-} " == *" $s "* ]]; then stub_for "$s" | write "$stubs_dir/$s"; echo "  + $stubs_dir/$s"
  else echo "  = $stubs_dir/$s"; fi
done
if grep -q '"mongodb/laravel-mongodb"' composer.json; then echo "  = composer.json (mongodb/laravel-mongodb)"
else
  # Same container as make new-app (composer:2, your uid, COMPOSER_AUTH forwarded by name).
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer -e COMPOSER_AUTH \
    -v "$PWD":/work -w /work composer:2 sh -c "\
    composer config platform.ext-mongodb $EXT_MONGODB_VERSION && \
    composer require --no-interaction --no-scripts -W mongodb/laravel-mongodb:$LARAVEL_MONGODB_VERSION mongodb/mongodb:$MONGODB_LIB_VERSION"
  echo "  ~ composer.json (mongodb/laravel-mongodb $LARAVEL_MONGODB_VERSION)"
fi
echo "mongo-setup OK: MongoDB (laravel-mongodb)"
