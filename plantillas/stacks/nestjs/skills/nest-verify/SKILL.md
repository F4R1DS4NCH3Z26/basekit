---
name: nest-verify
description: "Ejecuta TypeScript (tsc), oxlint y Vitest de un proyecto NestJS con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código TypeScript del backend en lugar de correr npx tsc, npm run lint o npm test directamente."
allowed-tools: Bash(bash .agents/skills/nest-verify/scripts/verify.sh:*)
---

# nest-verify

```bash
bash .agents/skills/nest-verify/scripts/verify.sh                         # todo src/
bash .agents/skills/nest-verify/scripts/verify.sh src/modules/products    # lint + tests de ese módulo
MAX_LINES=60 bash .agents/skills/nest-verify/scripts/verify.sh …          # más detalle si hace falta
```

- `tsc` siempre revisa el proyecto completo (los tipos cruzan módulos); oxlint y Vitest se limitan a la ruta.
- Si hay `prisma/schema.prisma` y falta el cliente generado (`src/generated/prisma`), corre `prisma generate` primero (sin red). Con MongoDB (Mongoose) no hay schema de Prisma ni nada que generar.
- Usa los binarios de `node_modules/.bin`. **No usa `npx`**: si TypeScript no está instalado, `npx tsc` descarga un paquete ajeno llamado `tsc`.
- Las herramientas no instaladas se marcan `SKIP`, no `FAIL`.
- Lee solo las líneas `FAIL` y su detalle. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
