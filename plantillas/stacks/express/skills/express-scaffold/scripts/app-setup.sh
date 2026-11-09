#!/usr/bin/env bash
# Completa la app Express de `make new-app`: si existe compose.db.yaml, Prisma 7 con el adaptador de esa BD
# (prisma/schema.prisma, prisma.config.ts y src/lib/db.ts) y el cliente generado. Lo ejecuta `make new-app` dentro
# de Docker; también sirve después de activar la BD con infra-setup (`make sh` y, dentro, este script).
# Idempotente: nunca sobrescribe código tuyo.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f package.json ] && [ -f src/app.ts ] || { echo "ERROR: ejecútalo en la raíz de la app Express (falta package.json o src/app.ts)"; exit 2; }
command -v npm >/dev/null || { echo "ERROR: falta npm (ejecútalo dentro del contenedor: make sh)"; exit 2; }
PRISMA_VERSION="${PRISMA_VERSION:-7.10.1}"
[[ $PRISMA_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: PRISMA_VERSION debe ser una versión exacta (x.y.z)"; exit 2; }
# Same rule as make new-app: every dependency as it was 14 days ago (guide 04 §8).
npm_config_before="${npm_config_before:-$(node -p 'new Date(Date.now() - 14 * 864e5).toISOString()')}"
export npm_config_before PRISMA_HIDE_UPDATE_MESSAGE=1
npm_add() { npm install --no-audit --no-fund --save-exact "$@"; }

# put <ruta>: escribe stdin en la ruta solo si no existe (atómico).
put() {
  if [ -e "$1" ]; then cat >/dev/null; echo "  = $1 (existe, se conserva)"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}

# DB_DRIVER sale del overlay que activó infra-setup (postgres | mysql | sqlite); sin overlay, sin BD ni Prisma.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
case "$driver" in
  postgres) provider=postgresql; adapter=@prisma/adapter-pg ;;
  mysql)    provider=mysql;      adapter=@prisma/adapter-mariadb ;;
  sqlite)   provider=sqlite;     adapter=@prisma/adapter-better-sqlite3 ;;
  "")       provider="" ;;
  *) echo "ERROR: DB_DRIVER desconocido en compose.db.yaml: $driver"; exit 2 ;;
esac

if [ -n "$provider" ]; then
  grep -q '"@prisma/client"' package.json || npm_add "@prisma/client@$PRISMA_VERSION"
  grep -q "\"$adapter\"" package.json || npm_add "$adapter@$PRISMA_VERSION"
  grep -q '"prisma"' package.json || npm_add -D "prisma@$PRISMA_VERSION"
  put prisma/schema.prisma <<PRISMA
// Esquema de datos (zona del orquestador). La conexión está en prisma.config.ts (migraciones) y src/lib/db.ts (app).
// El provider y el adaptador son los de la BD activa al correr app-setup.sh ($driver). Si cambias de BD, cambia
// ambos y vuelve a crear las migraciones (las de un provider no sirven para otro).
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
}

datasource db {
  provider = "$provider"
}

// Agrega aquí los modelos del contrato de cada módulo y luego: make migration NAME=<cambio> && make migrate
PRISMA
  put prisma.config.ts <<'TS'
import { defineConfig } from "prisma/config";

// DATABASE_URL la inyecta el overlay de BD (compose.db.yaml) en app y migrate. `prisma generate` no la necesita
// (corre en el build de la imagen, sin BD), por eso no se usa env(), que falla si falta.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
TS
  case "$driver" in
    postgres) imp='import { PrismaPg } from "@prisma/adapter-pg";'
              make_adapter='new PrismaPg({ connectionString: required("DATABASE_URL") })' ;;
    mysql)    imp='import { PrismaMariaDb } from "@prisma/adapter-mariadb";'
              # MySQL 8.4 autentica con caching_sha2_password; sin TLS (red interna de Compose) el driver pide la clave pública.
              make_adapter='new PrismaMariaDb({
    host: required("DB_HOST"),
    port: env.DB_PORT ?? 3306,
    user: required("DB_USERNAME"),
    password: required("DB_PASSWORD"),
    database: required("DB_DATABASE"),
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
  })' ;;
    sqlite)   imp='import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";'
              make_adapter='new PrismaBetterSqlite3({ url: required("DATABASE_URL") })' ;;
  esac
  put src/lib/db.ts <<TS
// Cliente de Prisma 7 (zona del orquestador) con el adaptador de la BD activa ($driver). Se crea en el primer uso:
// la app y /health arrancan sin base de datos. Solo lo importan los repository.ts.
$imp
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

type DbVar = "DATABASE_URL" | "DB_HOST" | "DB_USERNAME" | "DB_PASSWORD" | "DB_DATABASE";

// Las variables las inyecta el overlay de BD (compose.db.yaml); src/lib/env.ts las valida.
function required(name: DbVar): string {
  const value = env[name];
  if (!value) throw new Error(\`Falta \${name}: activa la BD con la skill infra-setup y ejecuta make env\`);
  return value;
}

function createAdapter() {
  return $make_adapter;
}

let client: PrismaClient | undefined;

export function db(): PrismaClient {
  client ??= new PrismaClient({ adapter: createAdapter() });
  return client;
}
TS
fi

# Rutas de build fuera del bloque de basekit (src/generated/ es el cliente de Prisma, se genera en cada build).
touch .gitignore
for p in node_modules/ dist/ coverage/ src/generated/; do
  grep -qxF "$p" .gitignore || { printf '%s\n' "$p" >> .gitignore; echo "  ~ .gitignore ($p)"; }
done

if [ -n "$provider" ]; then npx --no-install prisma generate; fi
echo "app-setup OK${provider:+: Prisma $PRISMA_VERSION ($provider, $adapter)}"
