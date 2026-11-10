---
name: gin-scaffold
description: "Crea la estructura de un módulo nuevo de backend Go · Gin (internal/<modulo>/ con model, dto, repository, errors, service y handler) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en Go, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/gin-scaffold/scripts/scaffold.sh:*)
---

# gin-scaffold

```bash
bash .agents/skills/gin-scaffold/scripts/scaffold.sh <modulo>   # nombre de paquete Go: orders, userprofiles
```

Crea `internal/<modulo>/` con un archivo por capa (solo la cláusula `package` y un comentario: compila vacío) y `docs/specs/<modulo>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada.

Después del scaffold:
1. Llena el contrato con el usuario: firmas y tablas, no prosa. Márcalo `Estado: cerrado`.
2. Crea la migración con `make migration NAME=create_<modulo>` y escribe su SQL a partir de la tabla del contrato (orquestador).
3. Sigue el flujo de AGENTS.md: data-writer → logic-writer → web-writer → qa-writer.
4. Registra el módulo en la lista `modules` de `cmd/api/main.go` (el script imprime la línea). Es tarea del orquestador.
