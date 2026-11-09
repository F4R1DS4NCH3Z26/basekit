---
name: nodenative-verify
description: Ejecuta TypeScript (tsc), ESLint y Vitest de una API en Node nativo (node:http) con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código TS en lugar de correr npx tsc, npm run lint o npm test directamente.
allowed-tools: Bash(bash .agents/skills/nodenative-verify/scripts/verify.sh:*)
---

# nodenative-verify

```bash
bash .agents/skills/nodenative-verify/scripts/verify.sh                       # todo src/ y tests/
bash .agents/skills/nodenative-verify/scripts/verify.sh src/modules/products  # lint de ese módulo + tests/modules/products
MAX_LINES=60 bash .agents/skills/nodenative-verify/scripts/verify.sh …        # más detalle si hace falta
```

- `tsc` siempre revisa el proyecto completo (los tipos cruzan módulos); ESLint y Vitest se limitan a la ruta.
- ESLint también revisa las capas: `services.ts` sin HTTP (`node:http`, `src/lib/router`, `src/lib/http`) ni Prisma (`@prisma/*`, `src/generated/`, `db()`), `router.ts` sin repositorio ni ORM. `src/generated/` (cliente de Prisma) no se revisa.
- Usa los binarios de `node_modules/.bin`. **No usa `npx`**: si TypeScript no está instalado, `npx tsc` descarga un paquete ajeno llamado `tsc`.
- Las herramientas no instaladas se marcan `SKIP`, no `FAIL`.
- Lee solo las líneas `FAIL` y su detalle. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
