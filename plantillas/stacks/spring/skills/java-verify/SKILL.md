---
name: java-verify
description: Compila y corre los tests de un dominio Spring Boot con Maven o Gradle en modo silencioso y offline, mostrando solo OK/FAIL y las líneas de error relevantes. Incluye siempre ArchitectureTest. Úsala para verificar cualquier cambio en código Java en lugar de correr mvnw o gradlew directamente.
allowed-tools: Bash(bash .agents/skills/java-verify/scripts/verify.sh:*)
---

# java-verify

```bash
bash .agents/skills/java-verify/scripts/verify.sh            # compila y corre todos los tests
bash .agents/skills/java-verify/scripts/verify.sh orders     # compila todo, tests de modules/orders + ArchitectureTest
OFFLINE=0 bash .agents/skills/java-verify/scripts/verify.sh  # permite descargar dependencias (pide permiso al usuario)
```

- Reemplaza a `./mvnw clean compile` de la v1: `clean` borra la compilación incremental y cada verificación recompila todo el proyecto.
- Modo `-q`/offline por defecto. Las dependencias deben estar en caché (la primera build la hace el usuario). Filtra la salida de Maven a las líneas `[ERROR]` útiles.
- Si el error está fuera de tu zona, repórtalo; no lo corrijas.
