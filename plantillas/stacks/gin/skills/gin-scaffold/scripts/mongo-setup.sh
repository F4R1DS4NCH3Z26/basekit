#!/usr/bin/env bash
# Cambia el esqueleto de basekit (GORM + goose) a MongoDB con el driver oficial (go.mongodb.org/mongo-driver/v2) cuando
# el overlay que activó infra-setup es MongoDB (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` antes
# de `go mod tidy`; con otra BD o sin BD no hace nada. Sin red. Idempotente.
# Nunca pisa un archivo tuyo: solo reemplaza o borra los archivos que siguen siendo el esqueleto intacto de basekit. Si
# uno cambió, se detiene sin tocar nada. La variante MongoDB está en ../assets/mongo/.
# Para pasar a MongoDB después de make new-app: activa la BD con infra-setup, borra go.sum y vuelve a ejecutar make new-app.
set -euo pipefail
assets="$(cd "$(dirname "$0")/.." && pwd)/assets/mongo"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f go.mod ] || { echo "ERROR: ejecútalo en la raíz del proyecto Go (falta go.mod)"; exit 2; }

# One exact match, shared with scaffold.sh and .make/stack.mk: the DB_DRIVER of the overlay infra-setup activated.
grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$' compose.db.yaml || exit 0

MONGO_DRIVER="go.mongodb.org/mongo-driver/v2 v2.9.2"
# Direct requirements of the starter that only the SQL variant uses; go mod tidy then drops their indirect ones.
SQL_MODULES="github.com/glebarez/sqlite github.com/go-sql-driver/mysql github.com/pressly/goose/v3 gorm.io/driver/mysql gorm.io/driver/postgres gorm.io/gorm"
# Starter files that only the SQL variant uses: removed while they are the untouched starter.
REMOVE="internal/platform/db/migrate.go migrations/migrations.go"

# goose migrations are never deleted: a project that already has them chose SQL.
for f in migrations/*.sql; do
  if [ -e "$f" ]; then
    echo "ERROR: migrations/ tiene migraciones SQL; no se borran. MongoDB no usa goose: quítalas tú si de verdad cambias de BD"
    exit 2
  fi
done

# sha256 of each starter file this script replaces or removes, as basekit copies it (a test pins them to starter/).
starter_sum() {
  case "$1" in
    cmd/api/main.go) echo f969766c5d8d64da603a51a5420d09569482b64329f3435262409bd36694310d ;;
    internal/platform/config/config.go) echo ff20b52d84e894f4ae9d2bb4fddd08a72a96a039aebd110c95ddfeaa097a23bd ;;
    internal/platform/db/db.go) echo ea25fc03690fee506c2caf530b872a73f10d18e895e2a1d6b090d870f1ede3d6 ;;
    internal/platform/db/db_test.go) echo 631808d7670308e107475d9865f6ade7874c0c40e8ee653151716cdb896dcb5c ;;
    internal/platform/db/migrate.go) echo b85c1d8112c142b10c9ba7d0c935f792451cd9069ab0d25745f2514d9bf61395 ;;
    migrations/migrations.go) echo d4cf6b59a1605b351648dfa414506067e4ff60292a26e7603346255efbcbc49d ;;
    *) echo none ;;
  esac
}
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
untouched() { [ "$(sum "$1")" = "$(starter_sum "$1")" ]; }

# 1. Plan, without writing: every file must be absent, the untouched starter or already the MongoDB variant.
plan=(); changed=()
while IFS= read -r f; do
  if [ ! -e "$f" ]; then plan+=("+ $f")
  elif cmp -s "$f" "$assets/$f"; then plan+=("= $f")
  elif untouched "$f"; then plan+=("~ $f")
  else changed+=("$f"); fi
done < <(cd "$assets" && find . -type f ! -path ./go.mod | sed 's#^\./##' | LC_ALL=C sort)
for f in $REMOVE; do
  if [ ! -e "$f" ]; then :
  elif untouched "$f"; then plan+=("- $f")
  else changed+=("$f"); fi
done
if [ ${#changed[@]} -gt 0 ]; then
  echo "ERROR: estos archivos cambiaron respecto al esqueleto de basekit y no se reemplazan (no se cambió nada):"
  printf '  %s\n' "${changed[@]}"
  echo "Pásalos tú a MongoDB (la variante está en .agents/skills/gin-scaffold/assets/mongo/) o restaura el esqueleto, y vuelve a ejecutarlo."
  exit 2
fi

# 2. Apply. Each write is atomic; chmod 644 because mktemp creates 0600 files and the starter's are world-readable.
for step in "${plan[@]}"; do
  op=${step%% *}; f=${step#* }
  case "$op" in
    "=") ;;
    "-") rm "$f" ;;
    *) mkdir -p "$(dirname "$f")"; tmp=$(mktemp "$f.XXXXXX"); cp "$assets/$f" "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$f" ;;
  esac
  echo "  $op $f"
done
# The embed package was the only file of migrations/: the folder goes with it, unless you keep something else there.
if [ -d migrations ] && [ -z "$(ls -A migrations)" ]; then rmdir migrations; fi

# go.mod is derived, never replaced: only the SQL requirements go and mongo-driver comes in; your other lines stay.
if grep -Eq "^[[:space:]]*(require[[:space:]]+)?${MONGO_DRIVER%% *} v[^[:space:]]+[[:space:]]*$" go.mod; then
  echo "  = go.mod"
else
  tmp=$(mktemp go.mod.XXXXXX)
  awk -v drop="$SQL_MODULES ${MONGO_DRIVER%% *}" -v add="$MONGO_DRIVER" '
    BEGIN { n = split(drop, d, " "); for (i = 1; i <= n; i++) skip[d[i]] = 1 }
    { mod = $1; if (mod == "require") mod = $2 }
    skip[mod] { next }
    !added && /^require \($/ { print; printf "\t%s\n", add; added = 1; next }
    { print }
    END { if (!added) printf "\nrequire %s\n", add }
  ' go.mod > "$tmp"
  chmod 644 "$tmp"; mv "$tmp" go.mod
  echo "  ~ go.mod"
fi
echo "mongo-setup OK: MongoDB (mongo-driver v2)"
