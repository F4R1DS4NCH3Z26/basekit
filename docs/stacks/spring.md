# Stack: Java · Spring Boot (DDD modular) · v3

Plantillas: `plantillas/stacks/spring/`. Auth por defecto: **Spring Security + JWT** (resource server con emisor propio). Puerto: 8080. Healthcheck: `/actuator/health`.

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
src/main/resources/db/migration/V<n>__*.sql         # domain-writer (versión fijada en el contrato)
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

- **`migrate`** usa la imagen `flyway/flyway:11` sobre `src/main/resources/db/migration`, con `SPRING_DATASOURCE_*` del overlay. La app también migra al arrancar; las dos vías son idempotentes.
- **`make migration NAME=x`** crea `V<n+1>__x.sql` con el siguiente número.
- **`make verify`** usa `VERIFY_ENV=-e OFFLINE=0`, porque dentro del contenedor Maven sí puede descargar.

`make new-app` (si no hay `pom.xml`) descarga el proyecto de **Spring Initializr** dentro de `alpine:3.20` y lo deja con tu uid:

| Parámetro | Valores | Por defecto |
|---|---|---|
| `SPRING_PKG` | paquete base (validado) | `com.app` |
| `SPRING_DB` | `postgresql`, `mysql`, `none` | `postgresql` |

Con base de datos, las dependencias son `web`, `validation`, `security`, `oauth2-resource-server`, `actuator`, `devtools`, `data-jpa`, `flyway` y el driver. Con `none`, se omiten las tres últimas.

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
- `clean` en cada verificación.
- Confiar en el `ownerId` del body.
