#!/usr/bin/env bash
# Crea el esqueleto de un bounded context Spring Boot. Sin red; no sobrescribe archivos existentes.
set -euo pipefail
name="${1:-}"
[[ $name =~ ^[a-z][a-z0-9]{1,30}$ ]] || { echo "Uso: scaffold.sh <dominio>  (minúsculas sin separadores, ej. orders)"; exit 2; }
# Paths from $0 first: a relative $0 (bash backend/.agents/...) no longer resolves after the cd.
assets="$(cd "$(dirname "$0")/.." && pwd)/assets"
# The project is four levels above this script (<project>/.agents/skills/<skill>/scripts/), also in backend/ or frontend/.
root=$(cd "$(dirname "$0")/../../../.." && pwd); cd "$root"
[ -f pom.xml ] || ls build.gradle* >/dev/null 2>&1 || { echo "ERROR: ejecútalo en la raíz del proyecto (falta pom.xml/build.gradle)"; exit 2; }

pkg="${BASE_PKG:-}"
if [ -z "$pkg" ]; then
  main=$(grep -rl --include='*.java' '@SpringBootApplication' src/main/java 2>/dev/null | head -1 || true)
  [ -n "$main" ] && pkg=$(sed -n 's/^package \([a-zA-Z0-9_.]*\);.*/\1/p' "$main" | head -1)
fi
[[ $pkg =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$ ]] || { echo "ERROR: no pude detectar el paquete base; usa BASE_PKG=com.ejemplo"; exit 2; }
ppath=${pkg//./\/}
dir="src/main/java/$ppath/modules/$name"
[ -e "$dir" ] && { echo "ERROR: $dir ya existe; no se sobrescribe"; exit 1; }
pascal="$(tr '[:lower:]' '[:upper:]' <<< "${name:0:1}")${name:1}"
# One exact match, shared with stack.mk and mongo-setup.sh: the overlay infra-setup activated says DB_DRIVER: mongodb.
mongo=0
grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$' compose.db.yaml && mongo=1

put() { [ -e "$1" ] && { echo "  = $1 (existe)"; return 0; }; mkdir -p "$(dirname "$1")"; printf '%s\n' "$2" > "$1"; echo "  + $1"; }
desc_domain="Entidades, excepciones e interfaces de repositorio. Sin Spring Web ni application."
desc_infrastructure="Implementaciones de repositorios (Spring Data) e integraciones externas."
[ $mongo = 1 ] && desc_infrastructure="Implementaciones de repositorios (Spring Data MongoDB) e integraciones externas."
desc_application="Servicios transaccionales, DTOs record y mappers."
desc_presentation="Controladores REST. Solo dependen de application."
for layer in domain infrastructure application presentation; do
  d="desc_$layer"
  put "$dir/$layer/package-info.java" "/** $name · $layer: ${!d} Contrato: docs/specs/${name}_contract.md */
package $pkg.modules.$name.$layer;"
done
put "src/test/java/$ppath/modules/$name/.gitkeep" ""
c="Contrato: docs/specs/${name}_contract.md § domain-writer."
if [ $mongo = 1 ]; then
put "$dir/domain/$pascal.java" "package $pkg.modules.$name.domain;

import java.util.Objects;
import java.util.UUID;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

/** Entidad MongoDB de $name: campos e índices (@Indexed; en prod los crea make migrate). $c */
@Document(collection = \"$name\")
public class $pascal {
    @Id private String id;
    @Indexed private String ownerId;

    protected $pascal() {} // requerido por Spring Data

    public static $pascal create(UUID ownerId) {
        var o = new $pascal();
        o.id = UUID.randomUUID().toString();
        o.ownerId = ownerId.toString();
        return o;
    }

    public boolean isOwnedBy(UUID userId) { return ownerId.equals(userId.toString()); }

    public String getId() { return id; }

    @Override public boolean equals(Object o) { return o instanceof $pascal other && Objects.equals(id, other.id); }
    @Override public int hashCode() { return Objects.hashCode(id); }
}"
put "$dir/domain/${pascal}Repository.java" "package $pkg.modules.$name.domain;

import java.util.Optional;

/** Contrato del dominio, sin Spring Data. $c */
public interface ${pascal}Repository {
    $pascal save($pascal entity);
    Optional<$pascal> findByIdAndOwnerId(String id, String ownerId);
}"
put "$dir/infrastructure/Mongo${pascal}Repository.java" "package $pkg.modules.$name.infrastructure;

import $pkg.modules.$name.domain.$pascal;
import $pkg.modules.$name.domain.${pascal}Repository;
import org.springframework.data.mongodb.repository.MongoRepository;

/** Spring Data MongoDB implementa la interfaz del dominio. $c */
interface Mongo${pascal}Repository extends MongoRepository<$pascal, String>, ${pascal}Repository {}"
keep=mongo; drop=sql
else
mkdir -p src/main/resources/db/migration
keep=sql; drop=mongo
fi
mkdir -p docs/specs
contract="docs/specs/${name}_contract.md"
# The contract template carries both data models between <!-- sql --> and <!-- mongo --> markers: keep this project's.
if [ -e "$contract" ]; then echo "  = $contract (existe)"
else sed -e "/<!-- $drop -->/,/<!-- \/$drop -->/d" -e "/<!-- \/*$keep -->/d" \
  -e "s/__NAME__/$name/g" -e "s/__PASCAL__/$pascal/g" -e "s/__PKG__/$pkg/g" "$assets/contract.md" > "$contract"; echo "  + $contract"; fi
if [ $mongo = 1 ]; then echo "scaffold OK: $pkg.modules.$name · MongoDB: índices con @Indexed en domain/ (make migrate los crea)"; exit 0; fi
last=$(ls src/main/resources/db/migration 2>/dev/null | sed -n 's/^V\([0-9][0-9]*\)__.*/\1/p' | sort -n | tail -1)
echo "scaffold OK: $pkg.modules.$name · siguiente versión Flyway sugerida: V$(( ${last:-0} + 1 ))"
