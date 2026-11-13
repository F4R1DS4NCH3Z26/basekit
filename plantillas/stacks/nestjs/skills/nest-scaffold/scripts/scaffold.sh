#!/usr/bin/env bash
# Crea el esqueleto de un módulo NestJS. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9-]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (kebab-case en plural, ej. products, order-items)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f nest-cli.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto NestJS (falta nest-cli.json; ¿make new-app?)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')
# Same source as app-setup.sh: the DB_DRIVER of the overlay infra-setup activated. mongodb → Mongoose; anything else → Prisma.
driver=""
[ -f compose.db.yaml ] && driver=$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml | head -1)

mkdir -p "$dir" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
c="Contrato: docs/specs/${name}_contract.md"

put "$dir/$name.schemas.ts" "import { z } from 'zod';

// Schemas Zod de entrada y salida de $name. $c § data-writer"
if [ "$driver" = mongodb ]; then
put "$dir/$name.model.ts" "import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';

// Modelo Mongoose de $name: campos e índices (en prod los crea make migrate). $c § Común
// Tipo explícito en cada @Prop: Vitest no emite metadata de decoradores.
@Schema({ collection: '$name', timestamps: true, versionKey: false })
export class ${pascal}Entity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;
}

export const ${pascal}EntitySchema = SchemaFactory.createForClass(${pascal}Entity);"
put "$dir/$name.repository.ts" "import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ${pascal}Entity } from './$name.model.js';

// Acceso a datos de $name con Mongoose (Model inyectado). $c § data-writer
@Injectable()
export class ${pascal}Repository {
  constructor(@InjectModel(${pascal}Entity.name) private readonly model: Model<${pascal}Entity>) {}
}"
else
put "$dir/$name.repository.ts" "import { Injectable } from '@nestjs/common';

// Acceso a datos de $name con Prisma (inyecta PrismaService). $c § data-writer
@Injectable()
export class ${pascal}Repository {}"
fi
put "$dir/$name.errors.ts" "// Errores de dominio de $name (sin HTTP). $c § logic-writer
export class ${pascal}Error extends Error {}"
put "$dir/$name.service.ts" "import { Injectable } from '@nestjs/common';
import { ${pascal}Repository } from './$name.repository.js';

// Casos de uso de $name (sin HTTP). $c § logic-writer
@Injectable()
export class ${pascal}Service {
  constructor(private readonly repository: ${pascal}Repository) {}
}"
put "$dir/$name.controller.ts" "import { Controller } from '@nestjs/common';
import { ${pascal}Service } from './$name.service.js';

// Endpoints HTTP de $name. $c § web-writer
@Controller('$name')
export class ${pascal}Controller {
  constructor(private readonly service: ${pascal}Service) {}
}"
if [ "$driver" = mongodb ]; then
put "$dir/$name.module.ts" "import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ${pascal}Controller } from './$name.controller.js';
import { ${pascal}Entity, ${pascal}EntitySchema } from './$name.model.js';
import { ${pascal}Repository } from './$name.repository.js';
import { ${pascal}Service } from './$name.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: ${pascal}Entity.name, schema: ${pascal}EntitySchema }])],
  controllers: [${pascal}Controller],
  providers: [${pascal}Service, ${pascal}Repository],
})
export class ${pascal}Module {}"
keep=mongo; drop=prisma
else
put "$dir/$name.module.ts" "import { Module } from '@nestjs/common';
import { ${pascal}Controller } from './$name.controller.js';
import { ${pascal}Repository } from './$name.repository.js';
import { ${pascal}Service } from './$name.service.js';

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service, ${pascal}Repository],
})
export class ${pascal}Module {}"
keep=prisma; drop=mongo
fi
# The contract template carries both data models between <!-- prisma --> and <!-- mongo --> markers: keep this project's.
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe, se conserva)"
else sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" \
  "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
echo "Registro (orquestador, src/app.module.ts): import { ${pascal}Module } from './modules/$name/$name.module.js'; y agrégalo a imports"
