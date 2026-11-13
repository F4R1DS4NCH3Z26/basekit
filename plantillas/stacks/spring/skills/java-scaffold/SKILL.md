---
name: java-scaffold
description: Crea la estructura de un bounded context nuevo en Spring Boot (modules/<dominio>/ con domain, application, infrastructure y presentation, carpeta de tests y de migraciones Flyway; con MongoDB, la entidad @Document y sus repositorios) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un dominio, módulo o entidad nueva en un proyecto Java/Spring, antes de escribir código o contrato a mano.
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
- Con MongoDB (overlay con `DB_DRIVER: mongodb`): crea además la entidad `@Document` (`domain/<Pascal>.java`, id `String` con un UUID y `ownerId` con `@Indexed`), la interfaz `domain/<Pascal>Repository.java` y `infrastructure/Mongo<Pascal>Repository.java` (`MongoRepository`). No crea `db/migration/`: no hay migraciones. El contrato trae la colección en lugar de la tabla.

`scripts/mongo-setup.sh` lo ejecuta `make new-app` después de Initializr cuando la BD es MongoDB (con otra BD no hace nada). Solo crea archivos que faltan y agrega un bloque a `application.properties`; si `application-dev.properties` ya existe sin la línea de índices, se detiene sin cambiar nada:

- `application.properties`: `spring.mongodb.uri=${SPRING_DATA_MONGODB_URI}` (sin esa variable la app no arranca) y `spring.data.mongodb.auto-index-creation=false`;
- `application-dev.properties`: `auto-index-creation=true` (en dev la app crea los índices al arrancar);
- `core/mongo/CreateIndexes.java`: el paso de `make migrate`, que crea los índices declarados y nunca borra uno;
- `compose.mongo-migrate.yaml`: el servicio `migrate` de MongoDB (la imagen prod de la app, uid 1001, en lugar de Flyway).

Después: llena el contrato con el usuario (incluido el número de versión Flyway, para que dos dominios no choquen; con MongoDB, los campos e índices de la colección) y márcalo `Estado: cerrado`.
