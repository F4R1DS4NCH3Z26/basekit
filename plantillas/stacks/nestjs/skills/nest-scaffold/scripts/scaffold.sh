#!/usr/bin/env bash
# Crea el esqueleto de un módulo NestJS. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9-]{1,40}$ ]] || { echo "Uso: scaffold.sh <modulo>  (kebab-case en plural, ej. products, order-items)"; exit 2; }
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f nest-cli.json ] || { echo "ERROR: ejecútalo en la raíz del proyecto NestJS (falta nest-cli.json; ¿make new-app?)"; exit 2; }
dir="src/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
pascal=$(echo "$name" | awk -F- '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')

mkdir -p "$dir" docs/specs
put() { [ -e "$1" ] && { echo "  = $1 (existe, se conserva)"; return 0; }; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
c="Contrato: docs/specs/${name}_contract.md"

put "$dir/$name.schemas.ts" "import { z } from 'zod';

// Schemas Zod de entrada y salida de $name. $c § data-writer"
put "$dir/$name.repository.ts" "import { Injectable } from '@nestjs/common';

// Acceso a datos de $name con Prisma (inyecta PrismaService). $c § data-writer
@Injectable()
export class ${pascal}Repository {}"
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
put "$dir/$name.module.ts" "import { Module } from '@nestjs/common';
import { ${pascal}Controller } from './$name.controller.js';
import { ${pascal}Repository } from './$name.repository.js';
import { ${pascal}Service } from './$name.service.js';

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service, ${pascal}Repository],
})
export class ${pascal}Module {}"
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe, se conserva)"
else sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
echo "scaffold OK: $name → llena el contrato y márcalo 'Estado: cerrado'"
echo "Registro (orquestador, src/app.module.ts): import { ${pascal}Module } from './modules/$name/$name.module.js'; y agrégalo a imports"
