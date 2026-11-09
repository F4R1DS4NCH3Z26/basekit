---
name: vue-verify
description: "Ejecuta vue-tsc (-b), ESLint y Vitest de una SPA Vue + Vite con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código TS o en componentes .vue en lugar de correr npx vue-tsc, npm run lint o npm test directamente."
allowed-tools: Bash(bash .agents/skills/vue-verify/scripts/verify.sh:*)
---

# vue-verify

```bash
bash .agents/skills/vue-verify/scripts/verify.sh                       # todo src/
bash .agents/skills/vue-verify/scripts/verify.sh src/features/products # lint + tests de esa feature
MAX_LINES=60 bash .agents/skills/vue-verify/scripts/verify.sh …        # más detalle si hace falta
```

- `vue-tsc -b` siempre revisa el proyecto completo (los tipos cruzan features y `tsc` no entiende los `.vue`); ESLint y Vitest se limitan a la ruta.
- Usa los binarios de `node_modules/.bin`. **No usa `npx`**: si una herramienta no está instalada, `npx` podría descargar un paquete ajeno con ese nombre.
- Las herramientas no instaladas se marcan `SKIP`, no `FAIL`.
- Lee solo las líneas `FAIL` y su detalle. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
