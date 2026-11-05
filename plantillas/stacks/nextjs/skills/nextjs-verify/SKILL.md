---
name: nextjs-verify
description: Ejecuta TypeScript (tsc), ESLint y Vitest de un proyecto Next.js con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código TS/TSX en lugar de correr npx tsc, npm run lint o npm test directamente.
allowed-tools: Bash(bash .agents/skills/nextjs-verify/scripts/verify.sh:*)
---

# nextjs-verify

```bash
bash .agents/skills/nextjs-verify/scripts/verify.sh                       # todo src/
bash .agents/skills/nextjs-verify/scripts/verify.sh src/features/products # lint + tests de esa feature
MAX_LINES=60 bash .agents/skills/nextjs-verify/scripts/verify.sh …        # más detalle si hace falta
```

- `tsc` siempre revisa el proyecto completo (los tipos cruzan features); ESLint y Vitest se limitan a la ruta.
- Usa los binarios de `node_modules/.bin`. **No usa `npx`**: si TypeScript no está instalado, `npx tsc` descarga un paquete ajeno llamado `tsc`.
- Las herramientas no instaladas se marcan `SKIP`, no `FAIL`.
- Lee solo las líneas `FAIL` y su detalle. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
