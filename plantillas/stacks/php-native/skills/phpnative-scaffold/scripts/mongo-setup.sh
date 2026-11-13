#!/usr/bin/env bash
# Prepara el esqueleto PHP nativo para MongoDB (librería mongodb/mongodb) cuando el overlay que activó infra-setup es
# MongoDB (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` antes de generar composer.lock; con otra BD
# o sin BD no hace nada. Sin red. Idempotente: lo que ya tiene la variante MongoDB se conserva. Nunca pisa un archivo
# que cambiaste: si no reconoce el original, se detiene sin cambiar nada y dice qué agregar a mano.
# Para pasar a MongoDB después de make new-app: activa la BD con infra-setup, borra composer.lock y vuelve a ejecutar
# make new-app.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"

# Same exact match as scaffold.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
[ "$driver" = mongodb ] || exit 0

[ -f composer.json ] && [ -d src/Core ] || { echo "ERROR: ejecútalo en la raíz del proyecto PHP nativo (falta composer.json o src/Core)"; exit 2; }

# Exact versions (repo rule), each at least 14 days old.
MONGODB_LIB_VERSION=2.5.0   # mongodb/mongodb (2026-09-29)
EXT_MONGODB_VERSION=2.5.5   # PECL mongodb (2026-10-15); mongodb/mongodb 2.5 needs ext-mongodb ^2.5

# The starter's lines: only these exact lines are changed. Anything else is the user's.
starter_ext='RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite opcache redis \'
mongo_ext="RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite opcache redis mongodb-$EXT_MONGODB_VERSION \\"
starter_req='        "ext-pdo": "*"'

mongo_php() {
  cat <<'PHP'
<?php

declare(strict_types=1);

namespace App\Core\Database;

use App\Core\Env;
use MongoDB\Client;
use MongoDB\Collection;
use MongoDB\Database;

/**
 * MongoDB (mongodb/mongodb) from the MongoDB overlay: MONGO_URL (the app user, authSource = DB_NAME) and
 * DB_DATABASE. Autowired (it only needs Env); it connects on the first operation, so /health never touches the
 * database. Documents come back as PHP arrays.
 */
final class Mongo
{
    private ?Database $database = null;

    public function __construct(private readonly Env $env) {}

    public function database(): Database
    {
        if ($this->database === null) {
            $url = $this->env->get('MONGO_URL') ?? throw new \RuntimeException('MONGO_URL is missing (activate MongoDB with the infra-setup skill and make env)');
            $name = $this->env->get('DB_DATABASE') ?? throw new \RuntimeException('DB_DATABASE is missing');
            $client = new Client($url, [], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);
            $this->database = $client->getDatabase($name);
        }

        return $this->database;
    }

    public function collection(string $name): Collection
    {
        return $this->database()->getCollection($name);
    }
}
PHP
}

indexes_php() {
  cat <<'PHP'
<?php

declare(strict_types=1);

use App\Core\Database\Mongo;
use App\Core\Env;

// `make migrate` with MongoDB: creates the indexes that the modules declare in src/Modules/<M>/Migrations/indexes.php
// (collection => list of createIndexes specs) and never drops one. MongoDB has no migrations: an index removed from
// indexes.php stays until you drop it by hand (make db-shell → db.<collection>.dropIndex('<name>')).
require dirname(__DIR__) . '/vendor/autoload.php';

$mongo = new Mongo(Env::fromGlobals());
$collections = 0;
try {
    foreach (glob(dirname(__DIR__) . '/src/Modules/*/Migrations/indexes.php') ?: [] as $file) {
        $declared = require $file;
        if (!is_array($declared)) {
            throw new \LogicException(sprintf('%s must return [collection => list of index specs]', $file));
        }
        foreach ($declared as $collection => $indexes) {
            if (!is_string($collection) || !is_array($indexes)) {
                throw new \LogicException(sprintf('%s must return [collection => list of index specs]', $file));
            }
            if ($indexes !== []) {
                $mongo->collection($collection)->createIndexes(array_values($indexes));
            }
            echo sprintf("  %s: %d declared indexes\n", $collection, count($indexes));
            ++$collections;
        }
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'mongo-indexes: ' . $e->getMessage() . "\n");
    exit(1);
}
echo $collections === 0
    ? "mongo-indexes: no collection declared in src/Modules/*/Migrations/indexes.php\n"
    : sprintf("mongo-indexes OK: %d collections\n", $collections);
PHP
}

# 1. Check everything first: on any refusal nothing has been changed.
docker_action=keep
if grep -Eq '^RUN install-php-extensions .*[[:space:]]mongodb(-[0-9.]+)?([[:space:]]|$)' Dockerfile 2>/dev/null; then :
elif [ -f Dockerfile ] && grep -qxF "$starter_ext" Dockerfile; then docker_action=change
else
  echo "ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca."
  echo "       Agrega mongodb-$EXT_MONGODB_VERSION a install-php-extensions y vuelve a ejecutar make new-app."
  exit 2
fi
composer_action=keep
if ! grep -q '"mongodb/mongodb"' composer.json; then
  # The starter's last require entry, followed by the end of "require".
  [ "$(awk -v r="$starter_req" 'prev == r && $0 == "    }," { n++ } { prev = $0 } END { print n + 0 }' composer.json)" = 1 ] || {
    echo "ERROR: composer.json no tiene la sección require del kit; no se toca."
    echo "       Agrega a \"require\": \"ext-mongodb\": \"*\" y \"mongodb/mongodb\": \"$MONGODB_LIB_VERSION\", y vuelve a ejecutar make new-app."
    exit 2; }
  composer_action=add
fi
new_files=()
for f in src/Core/Database/Mongo.php bin/mongo-indexes.php; do
  case "$f" in *Mongo.php) gen=mongo_php ;; *) gen=indexes_php ;; esac
  if [ ! -e "$f" ]; then new_files+=("$f")
  elif ! cmp -s <($gen) "$f"; then
    echo "ERROR: $f ya existe con otro contenido; no se pisa. Bórralo (o muévelo) y vuelve a ejecutar make new-app."
    exit 2
  fi
done

# write <ruta>: stdin → ruta en un paso (mktemp + mv); chmod 644 because mktemp creates 0600 files.
write() { local tmp; mkdir -p "$(dirname "$1")"; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; }

# 2. Apply.
if [ $docker_action = change ]; then
  # ENVIRON, not awk -v: -v processes escapes, and gawk drops the line's trailing backslash, so nothing would match.
  S="$starter_ext" M="$mongo_ext" awk '$0 == ENVIRON["S"] { print ENVIRON["M"]; next } { print }' Dockerfile | write Dockerfile
  grep -qxF "$mongo_ext" Dockerfile || { echo "ERROR: no se pudo agregar mongodb-$EXT_MONGODB_VERSION al Dockerfile"; exit 1; }
  echo "  ~ Dockerfile (extensión mongodb-$EXT_MONGODB_VERSION)"
else echo "  = Dockerfile"; fi
if [ $composer_action = add ]; then
  awk -v r="$starter_req" -v v="$MONGODB_LIB_VERSION" '
    $0 == r { held = 1; next }
    held && $0 == "    }," { print r ","; print "        \"ext-mongodb\": \"*\","; print "        \"mongodb/mongodb\": \"" v "\""; held = 0 }
    held { print r; held = 0 }
    { print }' composer.json | write composer.json
  echo "  ~ composer.json (mongodb/mongodb $MONGODB_LIB_VERSION, ext-mongodb)"
else echo "  = composer.json"; fi
for f in src/Core/Database/Mongo.php bin/mongo-indexes.php; do
  case "$f" in *Mongo.php) gen=mongo_php ;; *) gen=indexes_php ;; esac
  if [[ " ${new_files[*]-} " == *" $f "* ]]; then $gen | write "$f"; echo "  + $f"
  else echo "  = $f"; fi
done
echo "mongo-setup OK: MongoDB (mongodb/mongodb)"
