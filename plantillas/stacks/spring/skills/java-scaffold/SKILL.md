---
name: java-scaffold
description: Crea la estructura de un bounded context nuevo en Spring Boot (modules/<dominio>/ con domain, application, infrastructure y presentation, carpeta de tests y de migraciones Flyway) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un dominio, módulo o entidad nueva en un proyecto Java/Spring, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/java-scaffold/scripts/scaffold.sh:*)
---

# java-scaffold

```bash
bash .agents/skills/java-scaffold/scripts/scaffold.sh <dominio>            # minúsculas: orders, billing
BASE_PKG=com.acme.shop bash .agents/skills/java-scaffold/scripts/scaffold.sh orders
```

- Detecta el paquete base buscando la clase `@SpringBootApplication` (o usa `BASE_PKG`).
- Crea `package-info.java` en cada capa: documenta la capa y hace que Git versione las carpetas.
- Crea el directorio de tests, `src/main/resources/db/migration/` y `docs/specs/<dominio>_contract.md` desde `assets/contract.md`.
- No sobrescribe nada.

Después: llena el contrato con el usuario (incluido el número de versión Flyway, para que dos dominios no choquen) y márcalo `Estado: cerrado`.
