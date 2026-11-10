---
name: gin-verify
description: "Ejecuta gofmt, go vet, staticcheck y go test de un proyecto Go con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código Go en lugar de correr go vet, staticcheck o go test directamente."
allowed-tools: Bash(bash .agents/skills/gin-verify/scripts/verify.sh:*)
---

# gin-verify

```bash
bash .agents/skills/gin-verify/scripts/verify.sh                    # todo el módulo (./...)
bash .agents/skills/gin-verify/scripts/verify.sh internal/orders    # solo ese paquete y sus subpaquetes
MAX_LINES=60 bash .agents/skills/gin-verify/scripts/verify.sh …    # más detalle
```

- `make verify SCOPE=internal/<m>` lo corre dentro del contenedor de desarrollo, que ya trae los módulos y staticcheck.
- Sin red: fija `GOPROXY=off` y `-mod=readonly`, así un paquete que falta falla en vez de descargarse. `OFFLINE=0` permite la red.
- staticcheck está fijado en `go.mod` (directiva `tool`) y corre con `go tool staticcheck`; si falta la directiva, se marca `SKIP`.
- `go test -count=1` (sin caché de resultados). "Sin tests" no cuenta como fallo.
- Si el error está fuera de tu zona, repórtalo; no lo corrijas.
