#!/usr/bin/env bash
# Completa una app recién creada con `nest new`: /health, CORS, ZodValidationPipe y, si existe compose.db.yaml,
# Prisma con el adaptador de esa BD (SQL) o Mongoose (MongoDB). Lo ejecuta `make new-app` dentro de Docker; también sirve después de
# activar la BD con infra-setup (`make sh` y, dentro, este script). Idempotente: nunca sobrescribe código tuyo.
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f package.json ] && [ -f nest-cli.json ] || { echo "ERROR: ejecútalo en la raíz de una app NestJS (falta package.json o nest-cli.json)"; exit 2; }
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
# replace_default <ruta> <marca>: reemplaza un archivo de `nest new` solo si aún no tiene la marca de basekit.
replace_default() {
  if [ -f "$1" ] && grep -q "$2" "$1"; then cat >/dev/null; echo "  = $1"; return 0; fi
  local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; mv "$tmp" "$1"; echo "  ~ $1"
}

# DB_DRIVER sale del overlay que activó infra-setup (postgres | mysql | sqlite | mongodb); sin overlay, sin BD.
driver=""; provider=""; mongo=0
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)
case "$driver" in
  postgres) provider=postgresql; adapter=@prisma/adapter-pg ;;
  mysql)    provider=mysql;      adapter=@prisma/adapter-mariadb ;;
  sqlite)   provider=sqlite;     adapter=@prisma/adapter-better-sqlite3 ;;
  mongodb)  mongo=1 ;;
  "")       ;;
  *) echo "ERROR: DB_DRIVER desconocido en compose.db.yaml: $driver"; exit 2 ;;
esac

grep -q '"zod"' package.json || npm_add zod@4

put src/health/health.controller.ts <<'TS'
import { Controller, Get } from '@nestjs/common';

// Healthcheck del contenedor (Dockerfile HEALTHCHECK). Sin auth ni BD: solo dice que el proceso responde.
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
TS
put src/health/health.module.ts <<'TS'
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
TS
put src/common/zod-validation.pipe.ts <<'TS'
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Valida el body, query o params con un schema Zod: `@Body(new ZodValidationPipe(schema)) body: Input`. */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      // Mensaje genérico + errores por campo; nunca el input ni detalles internos.
      throw new BadRequestException({ message: 'Datos inválidos', fieldErrors: z.flattenError(parsed.error).fieldErrors });
    }
    return parsed.data;
  }
}
TS
replace_default src/main.ts 'enableShutdownHooks' <<'TS'
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS_ORIGINS: orígenes separados por coma (.env). Sin la variable, ningún origen externo.
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
await bootstrap();
TS

if [ -n "$provider" ]; then
  grep -q '"@prisma/client"' package.json || npm_add "@prisma/client@$PRISMA_VERSION"
  grep -q "\"$adapter\"" package.json || npm_add "$adapter@$PRISMA_VERSION"
  grep -q '"prisma"' package.json || npm_add -D "prisma@$PRISMA_VERSION"
  put prisma/schema.prisma <<PRISMA
// Esquema de datos (zona del orquestador). La conexión está en prisma.config.ts y src/prisma/prisma.service.ts.
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
}

datasource db {
  provider = "$provider"
}
PRISMA
  put prisma.config.ts <<'TS'
import { defineConfig } from 'prisma/config';

// DATABASE_URL la inyecta el overlay de BD (compose.db.yaml) en app y migrate. `prisma generate` no la necesita
// (corre en el build de la imagen, sin BD), por eso no se usa env(), que falla si falta.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
TS
  case "$driver" in
    postgres) imp="import { PrismaPg } from '@prisma/adapter-pg';"
              make_adapter="new PrismaPg({ connectionString: requireEnv('DATABASE_URL') })" ;;
    mysql)    imp="import { PrismaMariaDb } from '@prisma/adapter-mariadb';"
              # MySQL 8.4 autentica con caching_sha2_password; sin TLS (red interna de Compose) el driver pide la clave pública.
              make_adapter="new PrismaMariaDb({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: requireEnv('DB_USERNAME'),
    password: requireEnv('DB_PASSWORD'),
    database: requireEnv('DB_DATABASE'),
    connectionLimit: 5,
    allowPublicKeyRetrieval: true,
  })" ;;
    sqlite)   imp="import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';"
              make_adapter="new PrismaBetterSqlite3({ url: requireEnv('DATABASE_URL') })" ;;
  esac
  put src/prisma/prisma.service.ts <<TS
import { Injectable, OnModuleDestroy } from '@nestjs/common';
$imp
import { PrismaClient } from '../generated/prisma/client.js';

// La conexión sale de las variables que el overlay de BD (compose.db.yaml, $driver) inyecta en app y migrate.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(\`Falta \${name}: activa la BD con la skill infra-setup y ejecuta make env\`);
  return value;
}

function createAdapter() {
  return $make_adapter;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: createAdapter() });
  }

  async onModuleDestroy(): Promise<void> {
    await this.\$disconnect();
  }
}
TS
  put src/prisma/prisma.module.ts <<'TS'
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Global: los repositories inyectan PrismaService sin importar este módulo.
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
TS
  replace_default src/app.module.ts 'HealthModule' <<'TS'
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

// Registro de módulos (zona del orquestador): agrega aquí cada src/modules/<m>/<m>.module.ts.
@Module({
  imports: [PrismaModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
TS
  grep -q 'PrismaModule' src/app.module.ts || echo "AVISO: agrega PrismaModule (./prisma/prisma.module.js) a imports en src/app.module.ts"
elif [ $mongo -eq 1 ]; then
  # Majors fixed by the Nest CLI version (Nest 12); npm_config_before picks the newest release at least 14 days old.
  grep -q '"@nestjs/mongoose"' package.json || npm_add @nestjs/mongoose@12 mongoose@9
  put src/mongo/mongo.module.ts <<'TS'
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// La conexión sale de MONGO_URL, que el overlay de BD (compose.db.yaml, mongodb) inyecta en app y migrate con el
// usuario de la app (readWrite solo en su base de datos).
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}: activa la BD con la skill infra-setup y ejecuta make env`);
  return value;
}

// autoIndex: en desarrollo Mongoose crea al arrancar los índices declarados en los modelos (@Schema). En producción
// no (construir un índice sobre una colección grande la carga): los crea `make migrate ENV=prod` (sync-indexes.ts).
// Nest espera a que la conexión abra antes de escuchar, así que un /health que responde prueba la conexión.
@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({ uri: requireEnv('MONGO_URL'), autoIndex: process.env.NODE_ENV !== 'production' }),
    }),
  ],
})
export class MongoModule {}
TS
  put src/mongo/sync-indexes.ts <<'TS'
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../app.module.js';

// `make migrate`: MongoDB no tiene migraciones. Crea los índices que declaran los modelos registrados con
// MongooseModule.forFeature y borra los que ya no declaran (Model.syncIndexes). Corre compilado: dist/mongo/sync-indexes.js.
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const connection = app.get<Connection>(getConnectionToken());
  const models = Object.values(connection.models);
  for (const model of models) {
    const dropped = await model.syncIndexes();
    console.log(`  ${model.modelName}: índices al día${dropped.length ? ` (borrados: ${dropped.join(', ')})` : ''}`);
  }
  console.log(models.length ? `sync-indexes OK: ${models.length} modelos` : 'sync-indexes: ningún modelo registrado');
} finally {
  await app.close();
}
TS
  replace_default src/app.module.ts 'HealthModule' <<'TS'
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';
import { MongoModule } from './mongo/mongo.module.js';

// Registro de módulos (zona del orquestador): agrega aquí cada src/modules/<m>/<m>.module.ts.
@Module({
  imports: [MongoModule, HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
TS
  grep -q 'MongoModule' src/app.module.ts || echo "AVISO: agrega MongoModule (./mongo/mongo.module.js) a imports en src/app.module.ts"
else
  replace_default src/app.module.ts 'HealthModule' <<'TS'
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthModule } from './health/health.module.js';

// Registro de módulos (zona del orquestador): agrega aquí cada src/modules/<m>/<m>.module.ts.
// Sin BD: activa una con la skill infra-setup y vuelve a ejecutar este script (agrega Prisma o Mongoose).
@Module({
  imports: [HealthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
TS
fi

# nest new --skip-git no crea .gitignore: se agregan aquí las rutas de build, fuera del bloque de basekit.
touch .gitignore
for p in node_modules/ dist/ coverage/ src/generated/ '*.tsbuildinfo'; do
  grep -qxF "$p" .gitignore || { printf '%s\n' "$p" >> .gitignore; echo "  ~ .gitignore ($p)"; }
done

if [ -n "$provider" ]; then npx --no-install prisma generate; fi
if [ $mongo -eq 1 ]; then echo "app-setup OK: /health, MongoDB (Mongoose)"; else echo "app-setup OK: /health${provider:+, Prisma ($provider)}"; fi
