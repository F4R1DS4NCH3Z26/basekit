## Stack: Java · Spring Boot (DDD modular)
- Build: Maven Wrapper dentro de Docker. Datos: JPA + Flyway (`src/main/resources/db/migration`). Auth: Spring Security + JWT (resource server, `core/security`). Capas verificadas por ArchUnit (`ArchitectureTest`).
- `modules/<dominio>/`: `domain/` (entidades, repositorios como interfaces, excepciones) · `infrastructure/` (Spring Data) · `application/` (servicios, DTOs `record`) · `presentation/` (controladores).
- Inyección por constructor; las entidades nunca salen por HTTP; `@Valid` en todo request; el dueño se toma del usuario autenticado.

| Rol | Zona |
|---|---|
| orquestador | lo común + `pom.xml`, `application*.yml`, `core/`, la clase main, `ArchitectureTest` |
| domain-writer | `domain/`, `infrastructure/`, `db/migration/` |
| app-writer | `application/` |
| web-writer | `presentation/` |
| qa-writer | `src/test/java/**/modules/` |

Comandos: `make dev` (puerto 8080; health en `/actuator/health`) · `make test` · `make verify SCOPE=<dominio>` · `make migrate` (Flyway)
