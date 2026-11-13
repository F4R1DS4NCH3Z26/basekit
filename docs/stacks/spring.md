# Stack: Java · Spring Boot (DDD modular) · v3

Plantillas: `plantillas/stacks/spring/`. Auth por defecto: **Spring Security + JWT** (resource server con emisor propio). Puerto: 8080. Healthcheck: `/actuator/health`. Bases de datos: `postgres`, `mysql` (JPA + Flyway) y `mongo` (Spring Data MongoDB) (`stack.json → dbs`); `init` no ofrece SQLite y rechaza `--db sqlite`.

## Arquitectura (bounded contexts)

```text
pom.xml  mvnw  .mvn/                                # orquestador
src/main/java/<pkg>/
├── <App>Application.java  core/                    # orquestador (security, CORS, GlobalExceptionHandler)
└── modules/<dominio>/
    ├── domain/  infrastructure/                    # domain-writer
    ├── application/                                # app-writer
    └── presentation/                               # web-writer
src/main/resources/application.yml                  # orquestador
src/main/resources/db/migration/V<n>__*.sql         # domain-writer (versión fijada en el contrato; no existe con MongoDB)
src/test/java/<pkg>/ArchitectureTest.java           # orquestador (ArchUnit)
src/test/java/<pkg>/modules/<dominio>/              # qa-writer
```

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `pom.xml`/`build.gradle*`, `mvnw*`, `.mvn/**`, `application*`, `**/core/**`, `*Application.java`, `package-info.java`, `ArchitectureTest.java`, `src/test/resources/**` |
| domain-writer | `modules/*/domain/**`, `modules/*/infrastructure/**`, `db/migration/**` |
| app-writer | `modules/*/application/**` |
| web-writer | `modules/*/presentation/**` |
| qa-writer | `src/test/java/**/modules/**` |

Skills: `java-scaffold` (detecta el paquete base), `java-verify` (la usa `make verify SCOPE=<dominio>`, que incluye `ArchitectureTest`), `java-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `base` | `eclipse-temurin:21-jdk` + Maven Wrapper |
| `dev` | `./mvnw spring-boot:run` (devtools); `.:/app` y el volumen `m2:/root/.m2` |
| `build` | `dependency:go-offline` + `package -DskipTests` con caché de BuildKit |
| `prod` | `eclipse-temurin:21-jre`, usuario `app` (1001), `MaxRAMPercentage=75`, `read_only` + `tmpfs`, healthcheck de actuator, sin stacktrace en los errores, actuator limitado a `health` e `info` |

- **`migrate`** usa la imagen `flyway/flyway:11` sobre `src/main/resources/db/migration`, con `SPRING_DATASOURCE_*` del overlay. La app también migra al arrancar; las dos vías son idempotentes. Con MongoDB, ver [Variante MongoDB](#variante-mongodb-spring-data-mongodb).
- **`make migration NAME=x`** crea `V<n+1>__x.sql` con el siguiente número.
- **`make verify`** usa `VERIFY_ENV=-e OFFLINE=0`, porque dentro del contenedor Maven sí puede descargar.

`make new-app` (si no hay `pom.xml`) descarga el proyecto de **Spring Initializr** dentro de `alpine:3.20` y lo deja con tu uid:

| Parámetro | Valores | Por defecto |
|---|---|---|
| `SPRING_PKG` | paquete base (validado) | `com.app` |
| `SPRING_DB` | `postgresql`, `mysql`, `mongodb`, `none` | Según `compose.db.yaml` (`mongodb` si su `DB_DRIVER` es `mongodb`; `none` si no hay base de datos) |

Con base de datos, las dependencias son `web`, `validation`, `security`, `oauth2-resource-server`, `actuator`, `devtools`, `data-jpa`, `flyway` y el driver. Con `mongodb`, `data-mongodb` en lugar de las tres últimas (y `SPRING_DB=mongodb` sin el overlay de MongoDB es un error de uso). Con `none`, se omiten las tres últimas.

Initializr fija la versión de Spring Boot (la que ofrece por defecto ese día) y su BOM fija la de Spring Data MongoDB y el driver.

## Variante MongoDB (Spring Data MongoDB)

Con `--db mongo`, `make new-app` pide `data-mongodb` a Initializr (sin JPA, Flyway ni driver SQL) y después ejecuta `java-scaffold/scripts/mongo-setup.sh`. El script no hace nada con otra BD; se detiene sin cambiar nada si `pom.xml` usa JPA o no tiene `spring-boot-starter-data-mongodb`, y si `application-dev.properties` ya existe sin la línea de índices. Solo crea archivos que faltan y agrega un bloque a `application.properties`:

| Archivo | Qué hace |
|---|---|
| `application.properties` | `spring.mongodb.uri=${SPRING_DATA_MONGODB_URI}` (la URI del overlay, con el usuario de la app y `authSource=DB_NAME`; sin ella la app no arranca) y `spring.data.mongodb.auto-index-creation=false` |
| `application-dev.properties` | `spring.data.mongodb.auto-index-creation=true`: en dev la app crea los índices declarados al arrancar |
| `core/mongo/CreateIndexes.java` | Solo con `--app.mongo.create-indexes=true`: crea los índices de cada `@Document` (`IndexOperations.createIndex`), escribe `create-indexes OK: <n> colecciones, <m> índices` y termina |
| `compose.mongo-migrate.yaml` | El servicio `migrate` de MongoDB: la imagen `prod` de la app (construida en cada `make migrate`, uid 1001) con ese argumento, en lugar de Flyway. Necesita Docker Compose 2.24 o posterior (`!reset`) |

- **`make migrate`** (y `make prod-migrate`) agrega `compose.mongo-migrate.yaml` a Compose (si falta, Compose falla; nunca termina en 0 sin hacer nada) y crea los índices declarados. Ni `make migrate` ni el arranque en dev borran un índice: quitar un `@Indexed` no lo quita de la BD. Bórralo a mano en `make db-shell` (`ENV=prod` en producción) con `db.<colección>.getIndexes()` y `db.<colección>.dropIndex('<nombre>')`.
- **`make migration`** solo imprime `MongoDB no tiene migraciones: los índices se declaran en las entidades (@Indexed en modules/<m>/domain) y make migrate los crea`, sin pedir `NAME` ni levantar contenedores.
- **`java-scaffold`** crea la entidad `@Document` (id `String` con un UUID, `ownerId` con `@Indexed`), la interfaz del repositorio en `domain/` y `Mongo<Pascal>Repository` (`MongoRepository`) en `infrastructure/`; no crea `db/migration/`. El contrato trae la colección en lugar de la tabla.
- **Servicios sin `@Transactional`**: el MongoDB del overlay no tiene réplica (sin transacciones) y no hay `TransactionManager`; cada `save` de un documento es atómico.
- **Tests**: los de servicio (Mockito) y `@WebMvcTest` no tocan la BD; `@DataMongoTest` y el `contextLoads` de Initializr usan el MongoDB de Compose (`make test` lo levanta). `ArchitectureTest` usa `@Document` en lugar de `jakarta.persistence.Entity`.

## Auth: Spring Security + JWT (detalle en `java-patterns/references/auth.md`)

1. **`SecurityConfig`**:
   - Sin estado y con CSRF desactivado: es una API Bearer, sin cookie de sesión.
   - `permitAll` solo para `health` y las rutas de login, registro y refresh.
   - `oauth2ResourceServer().jwt()` con un convertidor que pone **`CurrentUser`** como principal, para que `@AuthenticationPrincipal CurrentUser` funcione en los controladores.
2. **Firma y verificación**:
   - `SecretKey` HS256 desde `JWT_SECRET`; falla al arrancar si tiene menos de 32 bytes.
   - `NimbusJwtEncoder` y `NimbusJwtDecoder` con validadores de `iss` y `aud`.
   - `PasswordEncoder` delegante (bcrypt, que se puede migrar a argon2).
3. **`TokenService`**:
   - `issueAccess()` emite un access de 15 min con los roles.
   - El refresh es opaco y aleatorio, y se guarda con SHA-256.
4. **Dominio `auth`**:
   - Entidades `UserAccount` y `RefreshToken`, con la misma rotación y revocación por familia que en FastAPI.
   - Login con tiempo constante: `matches` contra un hash ficticio si el usuario no existe.
   - Rate limit con Bucket4j o en el proxy.
5. **Con IdP corporativo**: solo `spring.security.oauth2.resourceserver.jwt.issuer-uri`, sin emitir tokens propios.
6. **Variables**: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL=PT15M`, `REFRESH_TOKEN_TTL=P14D`, `CORS_ORIGINS`.

## Comandos

```bash
make dev
make test
make verify SCOPE=<dominio>
make migration NAME=create_orders
make migrate
```

## Seguridad específica

- **Entidades**: nunca salen por HTTP; lo verifica ArchUnit.
- **Validación**: `@Valid` + Bean Validation en todos los request records.
- **Consultas**: derivadas o con `:param`.
- **Errores**: `ProblemDetail` genéricos.
- **Secretos**: nunca en `application.yml`. Los keystores (`*.jks`, `*.p12`) ya están en `.dockerignore`. Para este stack, conviene que el CLI agregue al `deny` de Claude Code `Read(./**/*.jks)`, `Read(./**/*.p12)` y `Read(./**/application-prod.*)`; en OpenCode, las mismas reglas en `permission.read`.

## Errores comunes

- `@Autowired` en campos.
- `@SpringBootTest` para todo (usa slices).
- Dos dominios con la misma versión de Flyway.
- Con MongoDB: `@Transactional` en los servicios, o esperar que quitar un `@Indexed` borre el índice.
- `clean` en cada verificación.
- Confiar en el `ownerId` del body.
