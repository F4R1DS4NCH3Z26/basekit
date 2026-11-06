#!/usr/bin/env bash
# Verifica zonas de edición por agente usando git. Sin red, solo lectura (salvo el baseline en .git/).
# Uso: check_zones.sh --snapshot | --reset | --owners | <agente> [agente...]
set -euo pipefail

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "ERROR: no es un repositorio git"; exit 2; }
cd "$root"
ZONES=".agents/zones"
BASE="$(git rev-parse --git-dir)/zone-baseline"
[ -d "$ZONES" ] || { echo "ERROR: falta $ZONES/"; exit 2; }
[ $# -ge 1 ] || { echo "Uso: $0 --snapshot | --reset | --owners | <agente>..."; exit 2; }

changed() {  # archivos modificados, nuevos o borrados (incluye no versionados), separados por NUL
  # --no-renames: un renombrado cuenta como borrado + nuevo, así se revisan ambas rutas.
  # -z y core.quotePath=false: rutas literales (espacios, acentos, comillas), sin comillas ni escapes.
  git -c core.quotePath=false status --porcelain=v1 -z -uall --no-renames |
    while IFS= read -r -d '' e; do printf '%s\0' "${e:3}"; done
}
sig() { if [ -e "$1" ]; then git hash-object -- "$1"; else echo deleted; fi; }
nl='
'
new_changes() {  # cambios que no estaban (o eran distintos) en el baseline, separados por NUL
  changed | while IFS= read -r -d '' f; do
    # una ruta con salto de línea no cabe en el baseline (una línea por archivo): siempre se revisa
    if [ -f "$BASE" ] && [[ $f != *"$nl"* ]] && grep -qxF -- "$(sig "$f")	$f" "$BASE"; then continue; fi
    printf '%s\0' "$f"
  done
}
in_zone() {  # $1 archivo, $2 archivo de zona
  local g
  while IFS= read -r g || [ -n "$g" ]; do
    g="${g%%#*}"; g="${g%"${g##*[![:space:]]}"}"
    [ -z "$g" ] && continue
    # shellcheck disable=SC2053
    [[ $1 == $g ]] && return 0
  done < "$2"
  return 1
}

case "$1" in
  --snapshot)
    changed | while IFS= read -r -d '' f; do
      [[ $f == *"$nl"* ]] || printf '%s\t%s\n' "$(sig "$f")" "$f"
    done > "$BASE"
    echo "baseline: $(wc -l < "$BASE" | tr -d ' ') archivos"; exit 0 ;;
  --reset)
    rm -f "$BASE"; echo "baseline eliminado"; exit 0 ;;
  --owners)
    bad=0; total=0
    while IFS= read -r -d '' f; do
      [ -z "$f" ] && continue; total=$((total+1)); owned=0
      for z in "$ZONES"/*.txt; do in_zone "$f" "$z" && { owned=1; break; }; done
      [ $owned -eq 0 ] && { echo "SIN DUEÑO: $f"; bad=$((bad+1)); }
    done < <(changed)
    echo "owners: $total revisados, $bad sin dueño"; [ $bad -eq 0 ]; exit ;;
esac

zfiles=()
for a in "$@"; do
  [[ $a =~ ^[a-z][a-z0-9-]*$ ]] || { echo "ERROR: nombre de agente inválido: $a"; exit 2; }
  [ -f "$ZONES/$a.txt" ] || { echo "ERROR: no existe $ZONES/$a.txt"; exit 2; }
  zfiles+=("$ZONES/$a.txt")
done
[ -f "$BASE" ] || echo "AVISO: sin --snapshot previo; se revisan todos los cambios"

bad=0; total=0
while IFS= read -r -d '' f; do
  [ -z "$f" ] && continue; total=$((total+1)); ok=0
  for z in "${zfiles[@]}"; do in_zone "$f" "$z" && { ok=1; break; }; done
  [ $ok -eq 0 ] && { echo "FUERA DE ZONA: $f"; bad=$((bad+1)); }
done < <(new_changes)
echo "zone-check [$*]: $total cambios nuevos, $bad fuera de zona"
[ $bad -eq 0 ]
