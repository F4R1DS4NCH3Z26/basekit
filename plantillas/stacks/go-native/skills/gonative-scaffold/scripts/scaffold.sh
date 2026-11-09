#!/usr/bin/env bash
# Crea el esqueleto de un módulo Go nativo (net/http + database/sql). Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9]{1,30}$ ]] || { echo "Uso: scaffold.sh <modulo>  (paquete Go: minúsculas y dígitos, sin _ ni -, ej. orders)"; exit 2; }
case "$name" in platform|internal|cmd|migrations|main|test) echo "ERROR: '$name' es un nombre reservado"; exit 2 ;; esac
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd); cd "$root"
[ -f go.mod ] || { echo "ERROR: ejecútalo en la raíz del proyecto Go (falta go.mod)"; exit 2; }
dir="internal/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
pascal="$(printf '%s' "${name:0:1}" | tr '[:lower:]' '[:upper:]')${name:1}"

mkdir -p "$dir" docs/specs
c="Contrato: docs/specs/${name}_contract.md"
put() { # archivo, comentario (el paquete compila vacío)
  printf '%s\npackage %s\n' "$2" "$name" > "$1"; echo "  + $1"
}
put "$dir/model.go"      "// Modelo de $name (struct plano; el esquema lo fija la migración). $c § data-writer."
put "$dir/dto.go"        "// DTO de entrada/salida de $name. $c § data-writer."
put "$dir/repository.go" "// Repositorio SQL de $name (database/sql, implementa Repository de service.go). $c § data-writer."
put "$dir/errors.go"     "// Errores de dominio de $name. $c § logic-writer."
put "$dir/service.go"    "// Package $name: casos de uso (sin HTTP). $c § logic-writer."
put "$dir/handler.go"    "// Handlers net/http de $name. $c § web-writer."
contract="docs/specs/${name}_contract.md"
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else
  tmp=$(mktemp "$contract.XXXXXX")
  sed -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" "$assets/contract.md" > "$tmp" && mv "$tmp" "$contract"
  echo "  + $contract"
fi
echo "scaffold OK: $name"
echo "Migración (orquestador): make migration NAME=create_$name"
echo "Registro (orquestador, cmd/api/main.go, lista modules):"
echo "  $name.NewHandler($name.NewService($name.NewRepository(database)), auth.Required(authCfg)),"
