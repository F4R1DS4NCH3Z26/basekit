#!/usr/bin/env bash
# Completa una app Spring Boot con Spring Data MongoDB cuando el overlay que activó infra-setup es MongoDB
# (compose.db.yaml con DB_DRIVER: mongodb). Lo ejecuta `make new-app` después de Initializr; con otra BD o sin BD no hace
# nada. Sin red. Idempotente y nunca sobrescribe: solo crea archivos que faltan y agrega un bloque a application.properties.
#   - application.properties: spring.mongodb.uri desde SPRING_DATA_MONGODB_URI (la define el overlay; sin ella la app no
#     arranca) y auto-index-creation apagado;
#   - application-dev.properties: auto-index-creation encendido (en dev la app crea los índices al arrancar);
#   - core/mongo/CreateIndexes.java: el paso de `make migrate` (crea los índices declarados, nunca borra uno);
#   - compose.mongo-migrate.yaml: el servicio migrate de MongoDB (la imagen prod de la app en lugar de Flyway).
set -euo pipefail
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pom.xml ] || { echo "ERROR: ejecútalo en la raíz de la app Spring Boot (falta pom.xml)"; exit 2; }

# One exact match, shared with stack.mk and scaffold.sh: the DB_DRIVER of the overlay infra-setup activated.
grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$' compose.db.yaml || exit 0

# Every check runs before the first write, so a stop changes nothing.
if grep -q '<artifactId>spring-boot-starter-data-jpa</artifactId>' pom.xml; then
  echo "ERROR: pom.xml usa JPA (spring-boot-starter-data-jpa); MongoDB no usa JPA ni Flyway. Crea la app con make new-app y el overlay de MongoDB"
  exit 2
fi
grep -q '<artifactId>spring-boot-starter-data-mongodb</artifactId>' pom.xml || {
  echo "ERROR: pom.xml no tiene spring-boot-starter-data-mongodb (make new-app lo agrega con el overlay de MongoDB)"; exit 2; }
pkg="${BASE_PKG:-}"
if [ -z "$pkg" ]; then
  main=$(grep -rl --include='*.java' '@SpringBootApplication' src/main/java 2>/dev/null | head -1 || true)
  [ -n "$main" ] && pkg=$(sed -n 's/^package \([a-zA-Z0-9_.]*\);.*/\1/p' "$main" | head -1)
fi
[[ $pkg =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$ ]] || { echo "ERROR: no pude detectar el paquete base; usa BASE_PKG=com.ejemplo"; exit 2; }
props=src/main/resources/application.properties
dev=src/main/resources/application-dev.properties
if [ -f "$dev" ] && ! grep -q '^spring\.data\.mongodb\.auto-index-creation=' "$dev"; then
  echo "ERROR: $dev ya existe y no se sobrescribe; agrégale: spring.data.mongodb.auto-index-creation=true"
  exit 2
fi

# put <ruta>: escribe stdin en la ruta solo si no existe (atómico; 644 como los archivos de Initializr).
put() {
  if [ -e "$1" ]; then cat >/dev/null; echo "  = $1"; return 0; fi
  mkdir -p "$(dirname "$1")"; local tmp; tmp=$(mktemp "$1.XXXXXX"); cat > "$tmp"; chmod 644 "$tmp"; mv "$tmp" "$1"; echo "  + $1"
}

if [ -f "$props" ] && grep -q '^spring\.mongodb\.uri=' "$props"; then echo "  = $props"
else
  mkdir -p "$(dirname "$props")"
  # The block starts on a line of its own even when the file does not end with a newline.
  nl=""; [ -s "$props" ] && [ -n "$(tail -c 1 "$props")" ] && nl=$'\n'
  { printf '%s' "$nl"; cat <<'PROPS'; } >> "$props"
# MongoDB (basekit java-scaffold mongo-setup.sh). SPRING_DATA_MONGODB_URI comes from compose.db.yaml (app user, readWrite
# only on DB_NAME); without it the app does not start. Indexes: created at startup only in dev
# (application-dev.properties); in prod, by make migrate. Spring Data creates indexes, it never drops one.
spring.mongodb.uri=${SPRING_DATA_MONGODB_URI}
spring.data.mongodb.auto-index-creation=false
PROPS
  echo "  ~ $props"
fi

put "$dev" <<'PROPS'
# Dev (SPRING_PROFILES_ACTIVE=dev): the app creates the declared indexes at startup. In prod, make migrate does it.
spring.data.mongodb.auto-index-creation=true
PROPS

ppath=${pkg//./\/}
put "src/main/java/$ppath/core/mongo/CreateIndexes.java" <<JAVA
package $pkg.core.mongo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.index.IndexResolver;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.MongoMappingContext;
import org.springframework.stereotype.Component;

/**
 * make migrate (MongoDB): creates the indexes declared on every @Document entity (@Indexed, @CompoundIndex...) and exits.
 * It runs only with --app.mongo.create-indexes=true (compose.mongo-migrate.yaml). Create only: removing an index from an
 * entity never drops it from the collection; drop it by hand (make db-shell, then db.<collection>.dropIndex("<name>")).
 */
@Component
@ConditionalOnProperty(name = "app.mongo.create-indexes", havingValue = "true")
class CreateIndexes implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(CreateIndexes.class);
    private final MongoTemplate mongo;
    private final MongoMappingContext mapping;
    private final ConfigurableApplicationContext context;

    CreateIndexes(MongoTemplate mongo, MongoMappingContext mapping, ConfigurableApplicationContext context) {
        this.mongo = mongo;
        this.mapping = mapping;
        this.context = context;
    }

    @Override
    public void run(ApplicationArguments args) {
        var resolver = IndexResolver.create(mapping);
        int collections = 0;
        int count = 0;
        for (var entity : mapping.getPersistentEntities()) {
            if (!entity.isAnnotationPresent(Document.class)) continue;
            var ops = mongo.indexOps(entity.getType());
            for (var index : resolver.resolveIndexFor(entity.getTypeInformation())) {
                ops.createIndex(index);
                count++;
            }
            collections++;
        }
        log.info("create-indexes OK: " + collections + " colecciones, " + count + " índices");
        System.exit(SpringApplication.exit(context, () -> 0));
    }
}
JAVA

put compose.mongo-migrate.yaml <<'YAML'
# MongoDB (basekit java-scaffold mongo-setup.sh): `make migrate` adds this file, so the migrate service runs the app's prod
# image (built from this checkout on every run; uid 1001) with CreateIndexes instead of Flyway. It creates the indexes
# declared on the @Document entities and exits; it never drops one. Needs Docker Compose 2.24 or newer (!reset).
services:
  migrate:
    image: !reset null
    entrypoint: !reset null
    volumes: !reset []
    build:
      context: .
      target: prod
    pull_policy: build
    command: ["--app.mongo.create-indexes=true"]
YAML

echo "mongo-setup OK: MongoDB (Spring Data MongoDB) · índices: al arrancar en dev, con make migrate en prod"
