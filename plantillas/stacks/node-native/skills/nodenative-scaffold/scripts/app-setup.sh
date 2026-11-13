#!/usr/bin/env bash
# Completa la app Node nativa (node:http) de `make new-app`: si existe compose.db.yaml, Prisma 7 con el adaptador de esa BD
# (prisma/schema.prisma, prisma.config.ts y src/lib/db.ts) y el cliente generado; con MongoDB, Mongoose (src/mongo/ y
# src/server.ts, que conecta antes de escuchar). Lo ejecuta `make new-app` dentro de Docker; también sirve después de
# activar la BD con infra-setup (`make sh` y, dentro, este script). Idempotente: nunca sobrescribe código tuyo.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f package.json ] && [ -f src/app.ts ] || { echo "ERROR: ejecútalo en la raíz de la app (falta package.json o src/app.ts)"; exit 2; }
command -v npm >/dev/null || { echo "ERROR: falta npm (ejecútalo dentro del contenedor: make sh)"; exit 2; }
PRISMA_VERSION="${PRISMA_VERSION:-7.10.1}"
[[ $PRISMA_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: PRISMA_VERSION debe ser una versión exacta (x.y.z)"; exit 2; }
MONGOOSE_VERSION="${MONGOOSE_VERSION:-9.11.4}"
[[ $MONGOOSE_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: MONGOOSE_VERSION debe ser una versión exacta (x.y.z)"; exit 2; }
# Same rule as make new-app: every dependency as it was 14 days ago (guide 04 §8).
npm_config_before="${npm_config_before:-$(node -p 'new Date(Date.now() - 14 * 864e5).toISOString()')}"
export npm_config_before PRISMA_HIDE_UPDATE_MESSAGE=1
npm_add() { npm install --no-audit --no-fund --save-exact "$@"; }

# put <ruta>: escribe stdin en la ruta solo si no existe (atómico).
put() {
  if [ -e "$1" ]; then cat >/dev/null; echo "  = $1 (existe, se conserva)"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}

# DB_DRIVER sale del overlay que activó infra-setup (postgres | mysql | sqlite | mongodb); sin overlay, sin BD ni Prisma.
# The same sed is used by scaffold.sh and .make/stack.mk: one exact match for every Mongo check.
driver=""; mongo=0
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
case "$driver" in
  postgres) provider=postgresql; adapter=@prisma/adapter-pg ;;
  mysql)    provider=mysql;      adapter=@prisma/adapter-mariadb ;;
  sqlite)   provider=sqlite;     adapter=@prisma/adapter-better-sqlite3 ;;
  mongodb)  provider=""; mongo=1 ;;
  "")       provider="" ;;
  *) echo "ERROR: DB_DRIVER desconocido en compose.db.yaml: $driver"; exit 2 ;;
esac

# MongoDB: src/server.ts must connect before it listens. It is replaced only while it is still the kit's starter
# (cksum of plantillas/stacks/node-native/starter/src/server.ts; a test pins it); one you changed stops the script here,
# before anything is installed or written.
STARTER_SERVER="3430932451 1077"
server_mongo=keep
if [ $mongo -eq 1 ] && ! grep -q 'connectMongo' src/server.ts 2>/dev/null; then
  if [ -f src/server.ts ] && [ "$(cksum < src/server.ts)" = "$STARTER_SERVER" ]; then server_mongo=replace
  else
    echo "ERROR: src/server.ts no es el del kit (lo cambiaste); no se toca ni se instala nada."
    echo "  Agrega al arranque, antes de listen: import { connectMongo } from \"./mongo/connection.js\"; await connectMongo();"
    echo "  y vuelve a ejecutar este script (o quita tus cambios de src/server.ts)."
    exit 2
  fi
fi

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

if [ $mongo -eq 1 ]; then
  grep -q '"mongoose"' package.json || npm_add "mongoose@$MONGOOSE_VERSION"
  put src/mongo/connection.ts <<'TS'
// Conexión a MongoDB con Mongoose (zona del orquestador). MONGO_URL la inyecta el overlay de BD (compose.db.yaml,
// mongodb) en app y migrate, con el usuario de la app (readWrite solo en su base de datos).
import mongoose from "mongoose";
import { env } from "../lib/env.js";

// autoIndex: en desarrollo Mongoose crea al conectar los índices declarados en los modelos (src/modules/<m>/model.ts).
// En producción no (construir un índice sobre una colección grande la carga): los crea `make migrate ENV=prod`.
export async function connectMongo(autoIndex = env.NODE_ENV !== "production"): Promise<void> {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("Falta MONGO_URL: activa la BD con la skill infra-setup y ejecuta make env");
  await mongoose.connect(uri, { autoIndex });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
TS
  put src/mongo/sync-indexes.ts <<'TS'
// `make migrate`: MongoDB no tiene migraciones. Crea los índices que declaran los modelos (Model.createIndexes) y nunca
// borra ninguno: un índice que quitas del modelo sigue en la BD hasta que lo borras a mano
// (make db-shell → db.<colección>.dropIndex('<nombre>')). En dev corre con tsx; en prod, compilado (dist/mongo/sync-indexes.js).
import mongoose from "mongoose";
import "../app.js"; // registra los modelos: app.ts importa los routers, y estos los services, repositories y modelos
import { connectMongo } from "./connection.js";

await connectMongo(false);
try {
  const models = Object.values(mongoose.models);
  for (const model of models) {
    await model.createIndexes();
    console.log(`  ${model.modelName}: índices declarados creados`);
  }
  console.log(models.length ? `sync-indexes OK: ${models.length} modelos` : "sync-indexes: ningún modelo registrado");
} finally {
  await mongoose.disconnect();
}
TS
  if [ $server_mongo = replace ]; then
    tmp=$(mktemp src/server.ts.XXXXXX)
    cat > "$tmp" <<'TS'
// Arranque del servidor (zona del orquestador): node:http, timeouts acotados y cierre ordenado. Conecta a MongoDB antes
// de escuchar: un /health que responde prueba la conexión, y sin MONGO_URL la app no arranca.
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";
import { connectMongo, disconnectMongo } from "./mongo/connection.js";

await connectMongo();
const server = createServer(
  // requestTimeout acota cuánto puede tardar un cliente en enviar la petición (cuerpos lentos o enormes).
  { requestTimeout: 30_000, headersTimeout: 15_000 },
  createApp(),
);
server.keepAliveTimeout = 5_000;

server.listen(env.PORT, "0.0.0.0", () => {
  console.log(`API escuchando en el puerto ${env.PORT}`);
});

// docker stop envía SIGTERM: deja de aceptar conexiones, termina las peticiones en curso, cierra la conexión a MongoDB
// y sale con 0. Si alguna sigue abierta a los 10 s, se cierra a la fuerza (docker manda SIGKILL a los 10 s).
let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close(() => void disconnectMongo().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 8_000).unref();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);
TS
    chmod 644 "$tmp"; mv "$tmp" src/server.ts; echo "  ~ src/server.ts (conecta a MongoDB antes de escuchar)"
  else echo "  = src/server.ts"; fi
fi

# Rutas de build fuera del bloque de basekit (src/generated/ es el cliente de Prisma, se genera en cada build).
touch .gitignore
for p in node_modules/ dist/ coverage/ src/generated/; do
  grep -qxF "$p" .gitignore || { printf '%s\n' "$p" >> .gitignore; echo "  ~ .gitignore ($p)"; }
done

if [ -n "$provider" ]; then npx --no-install prisma generate; fi
if [ $mongo -eq 1 ]; then echo "app-setup OK: MongoDB (Mongoose $MONGOOSE_VERSION)"
else echo "app-setup OK${provider:+: Prisma $PRISMA_VERSION ($provider, $adapter)}"; fi
