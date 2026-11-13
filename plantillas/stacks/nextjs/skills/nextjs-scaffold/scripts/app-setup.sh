#!/usr/bin/env bash
# Conecta la app Next.js a MongoDB con Mongoose cuando el overlay que activó infra-setup es MongoDB (compose.db.yaml con
# DB_DRIVER: mongodb): instala mongoose (y tsx, para `make migrate`) y crea src/lib/db.ts, src/lib/sync-indexes.ts y
# src/instrumentation.ts. Con otra BD o sin BD no hace nada. Lo ejecuta `make new-app` dentro de Docker; también sirve
# después de activar MongoDB con infra-setup (`make sh` y, dentro, este script). Idempotente: nunca sobrescribe código tuyo.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f package.json ] || { echo "ERROR: ejecútalo en la raíz de la app Next.js (falta package.json; ¿make new-app?)"; exit 2; }

# Same sed as scaffold.sh and .make/stack.mk: one exact match for every Mongo check.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
[ "$driver" = mongodb ] || exit 0

command -v npm >/dev/null || { echo "ERROR: falta npm (ejecútalo dentro del contenedor: make sh)"; exit 2; }
MONGOOSE_VERSION="${MONGOOSE_VERSION:-9.11.4}"
TSX_VERSION="${TSX_VERSION:-4.23.15}"
for v in MONGOOSE_VERSION TSX_VERSION; do
  [[ ${!v} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERROR: $v debe ser una versión exacta (x.y.z)"; exit 2; }
done
# Same rule as make new-app: every dependency as it was 14 days ago (guide 04 §8).
npm_config_before="${npm_config_before:-$(node -p 'new Date(Date.now() - 14 * 864e5).toISOString()')}"
export npm_config_before
npm_add() { npm install --no-audit --no-fund --save-exact "$@"; }

# put <ruta>: escribe stdin en la ruta solo si no existe (atómico).
put() {
  if [ -e "$1" ]; then cat >/dev/null; echo "  = $1 (existe, se conserva)"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}

grep -q '"mongoose"' package.json || npm_add "mongoose@$MONGOOSE_VERSION"
grep -q '"tsx"' package.json || npm_add -D "tsx@$TSX_VERSION"

put src/lib/db.ts <<'TS'
// Conexión a MongoDB con Mongoose (zona del orquestador). MONGO_URL la inyecta el overlay de BD (compose.db.yaml,
// mongodb) en app y migrate, con el usuario de la app (readWrite solo en su base de datos). Sin "server-only": también
// lo importa src/lib/sync-indexes.ts (make migrate), que corre fuera de Next.js.
import mongoose from "mongoose";

// Una sola conexión por proceso, también con la recarga en caliente de next dev (que vuelve a evaluar los módulos).
const cache = globalThis as typeof globalThis & { mongoConnection?: Promise<typeof mongoose> };

// autoIndex: en desarrollo Mongoose crea al conectar los índices declarados en los modelos (src/features/<f>/model.ts).
// En producción no (construir un índice sobre una colección grande la carga): los crea `make migrate ENV=prod`.
export function connectDb(autoIndex = process.env.NODE_ENV !== "production"): Promise<typeof mongoose> {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error("Falta MONGO_URL: activa la BD con la skill infra-setup y ejecuta make env");
  cache.mongoConnection ??= mongoose.connect(uri, { autoIndex }).catch((error: unknown) => {
    cache.mongoConnection = undefined; // el siguiente intento vuelve a conectar
    throw error;
  });
  return cache.mongoConnection;
}
TS
put src/lib/sync-indexes.ts <<'TS'
// `make migrate`: MongoDB no tiene migraciones. Carga el modelo de cada feature (src/features/<f>/model.ts), crea los
// índices que declaran (Model.createIndexes) y nunca borra ninguno: un índice que quitas del modelo sigue en la BD
// hasta que lo borras a mano (make db-shell → db.<colección>.dropIndex('<nombre>')). Corre con tsx, en dev y en prod.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDb } from "./db";

async function main(): Promise<void> {
  const features = join(process.cwd(), "src", "features");
  for (const feature of existsSync(features) ? readdirSync(features) : []) {
    const file = join(features, feature, "model.ts");
    if (existsSync(file)) await import(pathToFileURL(file).href);
  }
  await connectDb(false);
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
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
TS
if [ -e src/instrumentation.ts ]; then
  echo "  = src/instrumentation.ts (existe, se conserva)"
  echo "AVISO: src/instrumentation.ts ya existe: agrega a register() la conexión (si process.env.NEXT_RUNTIME === \"nodejs\": await (await import(\"./lib/db\")).connectDb())"
else
  put src/instrumentation.ts <<'TS'
// Next.js llama a register() una vez al arrancar el servidor, antes de atender peticiones: conecta a MongoDB, así un
// /api/health que responde prueba la conexión, y sin MONGO_URL la app no arranca. Los services también llaman a
// connectDb() (devuelve la misma conexión).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { connectDb } = await import("./lib/db");
    await connectDb();
  }
}
TS
fi
echo "app-setup OK: MongoDB (Mongoose $MONGOOSE_VERSION)"
