---
name: zone-check
description: Verifica con git que los archivos que tocó un subagente estén dentro de su zona de edición (.agents/zones/<agente>.txt). Úsala SIEMPRE al orquestar subagentes escritores: --snapshot antes de delegar, `<agente>` al terminar cada uno y --owners al cerrar la feature o módulo.
allowed-tools: Bash(bash .agents/skills/zone-check/scripts/check_zones.sh:*)
---

# zone-check

Las zonas de edición escritas solo en el prompt no se cumplen siempre. Este script las convierte en una verificación objetiva y barata (imprime solo violaciones y una línea de resumen).

## Uso (lo ejecuta el orquestador, no los subagentes)

```bash
S=.agents/skills/zone-check/scripts/check_zones.sh
bash $S --snapshot                   # 1. antes de delegar: guarda el estado actual
bash $S data-writer                  # 2. tras el subagente: cambios nuevos fuera de su zona
bash $S --snapshot                   # 3. nueva foto antes del siguiente subagente
bash $S logic-writer ui-writer       #    agentes en paralelo: se valida contra la unión
bash $S --owners                     # 4. al cerrar: todo archivo cambiado tiene dueño
```

Códigos de salida: `0` OK, `1` violaciones, `2` error de uso o de entorno.

## Si hay violaciones

No las corrijas tú en silencio. Revierte el archivo (`git checkout -- <archivo>` si estaba versionado) o reasigna la tarea al agente dueño. Si la zona está mal definida, edita `.agents/zones/<agente>.txt` (es zona del orquestador).

## Formato de `.agents/zones/<agente>.txt`

Un patrón por línea, relativo a la raíz del repo; `#` para comentarios. `*` también cruza carpetas (`src/features/*/schemas.ts` acepta subcarpetas).
