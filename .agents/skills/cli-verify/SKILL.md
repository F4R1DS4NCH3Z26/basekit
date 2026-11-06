---
name: cli-verify
description: Verifica el CLI de basekit con salida mínima (tsc, dist/src y tests de node:test). Úsala después de cada cambio en src/, tests/ o plantillas/ y antes de reportar.
---
# cli-verify

```bash
bash .agents/skills/cli-verify/scripts/verify.sh            # suite completa
bash .agents/skills/cli-verify/scripts/verify.sh "infra.sh" # solo los tests cuyo nombre coincide
```

- Borra `dist/tests` (no se commitea) y compila con `tsc`, así no corre un test cuyo fuente ya no existe. Si `dist/src` cambió, avisa: va en el mismo commit que `src/`.
- Corre los tests compilados con `node --test`. Sin red; los tests que usan Docker se saltan solos si no está disponible.
- Imprime `OK`/`FAIL` por paso. Si algo falla, recorta a `MAX_LINES` líneas (30 por defecto): las primeras de `tsc` y las últimas de los tests, donde `node:test` pone los errores.
- Sale con 0 si todo pasa, 1 si algo falla y 2 si falta `node_modules` (ejecuta `npm ci`).
