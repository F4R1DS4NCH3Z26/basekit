import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: Spring Boot with Spring Data MongoDB. The scripts run offline here, with a fake docker; the real
// proof (Initializr, make dev, make migrate against MongoDB, in dev and prod) is `scripts/e2e.sh spring mongo`.
const MONGO_SETUP = ".agents/skills/java-scaffold/scripts/mongo-setup.sh";
const SCAFFOLD = ".agents/skills/java-scaffold/scripts/scaffold.sh";
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en las entidades (@Indexed en modules/<m>/domain) y make migrate los crea\n";
const INDEXES = "src/main/java/com/acme/shop/core/mongo/CreateIndexes.java";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A Spring project after init, with the database activated by infra-setup ("none": no database). */
function springProject(db: "mongo" | "postgres" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "spring"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
  return d;
}

const POM_DEPS = {
  mongo: ["spring-boot-starter-webmvc", "spring-boot-starter-data-mongodb"],
  jpa: ["spring-boot-starter-webmvc", "spring-boot-starter-data-jpa", "spring-boot-starter-flyway"],
  web: ["spring-boot-starter-webmvc"],
};

/** Shell lines that write what Spring Initializr leaves: pom.xml, the main class and application.properties. */
function initializrFiles(kind: keyof typeof POM_DEPS, pkg = "com.acme.shop"): string {
  const deps = POM_DEPS[kind].map((a) => `<dependency><groupId>org.springframework.boot</groupId><artifactId>${a}</artifactId></dependency>`);
  const main = `src/main/java/${pkg.replaceAll(".", "/")}`;
  return [
    `printf '%s\\n' '<project>' '${deps.join("' '")}' '</project>' > pom.xml`,
    `mkdir -p ${main} src/main/resources`,
    `printf '%s\\n' 'package ${pkg};' '@SpringBootApplication' 'public class AppApplication {}' > ${main}/AppApplication.java`,
    `printf 'spring.application.name=app\\n' > src/main/resources/application.properties`,
  ].join("\n");
}

/** A Spring project whose app Initializr already created (kind: its data dependencies). */
function springApp(db: "mongo" | "postgres" | "none", kind: keyof typeof POM_DEPS): string {
  const d = springProject(db);
  const r = sh("sh", ["-c", initializrFiles(kind)], d);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return d;
}

/** Every file of the project (path → content), to prove a run changed nothing. */
function tree(d: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(d, p), readFileSync(p, "utf8"));
    }
  };
  walk(d);
  return out;
}

/** A directory with fake executables that log their calls to `calls.log` (and run `body`, if given). */
function fakeBin(names: string[], body = ""): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n${body}\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe("mongo-setup.sh on Spring (mongo-support S9)", () => {
  it("with the MongoDB overlay: the URI from the overlay, auto-index only in dev, a create-only index step and its migrate service", () => {
    const d = springApp("mongo", "mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const props = read(d, "src/main/resources/application.properties");
    assert.match(props, /^spring\.application\.name=app$/m, "Initializr's line is kept");
    assert.match(props, /^spring\.mongodb\.uri=\$\{SPRING_DATA_MONGODB_URI\}$/m);
    assert.match(props, /^spring\.data\.mongodb\.auto-index-creation=false$/m);
    assert.equal(read(d, "src/main/resources/application-dev.properties").match(/^[^#].*$/gm)?.join("\n"), "spring.data.mongodb.auto-index-creation=true");
    const indexes = read(d, INDEXES);
    assert.match(indexes, /^package com\.acme\.shop\.core\.mongo;$/m);
    assert.match(indexes, /@ConditionalOnProperty\(name = "app\.mongo\.create-indexes", havingValue = "true"\)/);
    assert.match(indexes, /\.createIndex\(/);
    const code = indexes.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, ""); // comments explain how to drop an index by hand
    assert.doesNotMatch(code, /dropIndex|dropAllIndexes/, "the step can drop indexes");
    assert.match(indexes, /"create-indexes OK: " \+ collections \+ " colecciones, " \+ count \+ " índices"/);
    const migrate = read(d, "compose.mongo-migrate.yaml");
    assert.match(migrate, /^ {4}image: !reset null$/m, "the Flyway image would be retagged with the app build");
    assert.match(migrate, /^ {4}entrypoint: !reset null$/m);
    assert.match(migrate, /^ {4}volumes: !reset \[\]$/m);
    assert.match(migrate, /^ {6}target: prod$/m);
    assert.match(migrate, /^ {4}pull_policy: build$/m);
    assert.match(migrate, /^ {4}command: \["--app\.mongo\.create-indexes=true"\]$/m);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(Spring Data MongoDB\)/);
  });

  it("is idempotent: a second run changes nothing", () => {
    const d = springApp("mongo", "mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(r.stdout, /^ {2}[~+] /m, r.stdout);
  });

  for (const db of ["postgres", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing (JPA stays)`, () => {
      const d = springApp(db, db === "none" ? "web" : "jpa");
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("with the MongoDB overlay but a JPA app (or no Spring Data MongoDB): stops and changes nothing", () => {
    for (const kind of ["jpa", "web"] as const) {
      const d = springApp("mongo", kind);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.match(r.stdout, kind === "jpa" ? /ERROR: pom\.xml usa JPA/ : /ERROR: pom\.xml no tiene spring-boot-starter-data-mongodb/);
      assert.deepEqual(tree(d), before);
    }
  });

  it("never overwrites your application-dev.properties: without the auto-index line it stops and changes nothing", () => {
    const d = springApp("mongo", "mongo");
    writeFileSync(join(d, "src/main/resources/application-dev.properties"), "logging.level.root=debug\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: src\/main\/resources\/application-dev\.properties ya existe/);
    assert.deepEqual(tree(d), before);
  });
});

describe("make new-app on Spring (mongo-support S9)", () => {
  /** Runs make new-app with a fake docker that logs its arguments and leaves the Initializr files of `kind`. */
  function newApp(d: string, kind: keyof typeof POM_DEPS, args: string[] = []) {
    const fake = fakeBin(["docker"], initializrFiles(kind));
    const r = sh("make", ["new-app", ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
    return { ...r, calls: fake.calls() };
  }

  it("with the MongoDB overlay: Initializr gets data-mongodb (no JPA, Flyway or SQL driver) and mongo-setup runs", () => {
    const d = springProject("mongo");
    const r = newApp(d, "mongo");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.calls, /dependencies='web,validation,security,oauth2-resource-server,actuator,devtools,data-mongodb -o app\.zip/);
    assert.doesNotMatch(r.calls, /data-jpa|flyway|postgresql|mysql/);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(Spring Data MongoDB\)/);
    assert.ok(existsSync(join(d, INDEXES)));
    assert.ok(existsSync(join(d, "compose.mongo-migrate.yaml")));
  });

  it("with the PostgreSQL overlay: the same Initializr dependencies as before and no MongoDB files", () => {
    const d = springProject("postgres");
    const r = newApp(d, "jpa");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.calls, /dependencies='web,validation,security,oauth2-resource-server,actuator,devtools,data-jpa,flyway,postgresql -o app\.zip/);
    assert.doesNotMatch(r.stdout, /mongo-setup/);
    assert.ok(!existsSync(join(d, "compose.mongo-migrate.yaml")));
    assert.ok(!existsSync(join(d, "src/main/resources/application-dev.properties")));
  });

  it("on a SQL project without the skills folder: still works (mongo-setup is only called for MongoDB)", () => {
    const d = springProject("postgres");
    sh("rm", ["-rf", ".agents"], d);
    const r = newApp(d, "jpa");
    assert.equal(r.code, 0, r.stdout + r.stderr);
  });

  it("SPRING_DB=mongodb without the MongoDB overlay is a usage error, before any download", () => {
    const d = springProject("postgres");
    const r = newApp(d, "mongo", ["SPRING_DB=mongodb"]);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /SPRING_DB=mongodb necesita el overlay de MongoDB/);
    assert.equal(r.calls, "");
  });
});

describe("scaffold.sh on Spring (mongo-support S9)", () => {
  it("with the MongoDB overlay: a @Document entity with a UUID string id, its domain repository and a MongoRepository", () => {
    const d = springApp("mongo", "mongo");
    const r = sh("bash", [SCAFFOLD, "orders"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const base = "src/main/java/com/acme/shop/modules/orders";
    const entity = read(d, `${base}/domain/Orders.java`);
    assert.match(entity, /^package com\.acme\.shop\.modules\.orders\.domain;$/m);
    assert.match(entity, /^@Document\(collection = "orders"\)$/m);
    assert.match(entity, /^ {4}@Id private String id;$/m);
    assert.match(entity, /^ {4}@Indexed private String ownerId;$/m);
    assert.match(entity, /o\.id = UUID\.randomUUID\(\)\.toString\(\);/);
    assert.match(entity, /Contrato: docs\/specs\/orders_contract\.md § domain-writer/);
    const repo = read(d, `${base}/domain/OrdersRepository.java`);
    assert.match(repo, /Optional<Orders> findByIdAndOwnerId\(String id, String ownerId\);/);
    assert.doesNotMatch(repo, /springframework/, "the domain repository depends on Spring Data");
    const mongo = read(d, `${base}/infrastructure/MongoOrdersRepository.java`);
    assert.match(mongo, /^interface MongoOrdersRepository extends MongoRepository<Orders, String>, OrdersRepository \{\}$/m);
    assert.match(read(d, `${base}/infrastructure/package-info.java`), /Spring Data MongoDB/);
    assert.ok(!existsSync(join(d, "src/main/resources/db/migration")), "a Flyway folder in a MongoDB project");
    assert.match(r.stdout, /scaffold OK: com\.acme\.shop\.modules\.orders · MongoDB: índices con @Indexed en domain\/ \(make migrate los crea\)/);
  });

  it("with the MongoDB overlay: the contract keeps the MongoDB section, drops the SQL one and every marker", () => {
    const d = springApp("mongo", "mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^- Colección `orders` \(entidad `@Document` `Orders`; índices con `@Indexed`, sin migraciones\)$/m);
    assert.match(contract, /^\| _id \| String \(UUID\) \| no \| PK \|$/m);
    assert.match(contract, /`findByIdAndOwnerId\(String, String\): Optional<Orders>`/);
    assert.doesNotMatch(contract, /Migración: `V|Tipo SQL/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: only package-info files, the Flyway folder and the SQL contract, without markers", () => {
    const d = springApp("postgres", "jpa");
    const r = sh("bash", [SCAFFOLD, "orders"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const base = "src/main/java/com/acme/shop/modules/orders";
    assert.deepEqual(readdirSync(join(d, base, "domain")), ["package-info.java"]);
    assert.deepEqual(readdirSync(join(d, base, "infrastructure")), ["package-info.java"]);
    assert.match(read(d, `${base}/infrastructure/package-info.java`), /Implementaciones de repositorios \(Spring Data\) e integraciones externas\./);
    assert.ok(existsSync(join(d, "src/main/resources/db/migration")));
    assert.match(r.stdout, /scaffold OK: com\.acme\.shop\.modules\.orders · siguiente versión Flyway sugerida: V1\n$/);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^- Migración: `V<n>__create_orders\.sql` {2}\(n = <número único>\)$/m);
    assert.match(contract, /^\| Columna \| Tipo SQL \| Nulo \| Índice \/ FK \|$/m);
    assert.match(contract, /`findByIdAndOwnerId\(UUID, UUID\): Optional<Orders>`/);
    assert.doesNotMatch(contract, /MongoDB|Colección|@Document/, "the MongoDB section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe("migrations on Spring (mongo-support S9)", () => {
  it("with MongoDB, make migration only prints that there are no migrations: no NAME check, no container", () => {
    const d = springProject("mongo");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    for (const args of [[], ["NAME=create_orders"], ["NAME=Bad Name"]]) {
      const r = sh("make", ["migration", ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, MIGRATION_LINE, args.join(" "));
    }
    assert.equal(fake.calls(), "");
    assert.match(read(d, ".make/stack.mk"), /^MONGO_MIGRATION_MSG := MongoDB no tiene migraciones/m);
  });

  it("with PostgreSQL, make migration still checks NAME and creates the next Flyway file in the app container", () => {
    const d = springProject("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.equal(fake.calls(), "");
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app sh -c n=\$\(ls src\/main\/resources\/db\/migration/m);
  });

  for (const env of ["dev", "prod"] as const) {
    it(`make migrate (${env}): with MongoDB, compose.mongo-migrate.yaml replaces the Flyway service; with PostgreSQL, Flyway as before`, () => {
      for (const db of ["mongo", "postgres"] as const) {
        const d = springProject(db);
        assert.equal(sh("make", ["env", `ENV=${env}`], d).code, 0);
        const fake = fakeBin(["docker"]);
        const r = sh("make", ["migrate", `ENV=${env}`], d, { PATH: `${fake.path}:${process.env.PATH}` });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        const call = fake.calls();
        assert.match(call, new RegExp(`-f compose\\.yaml -f compose\\.${env}\\.yaml -f compose\\.db\\.yaml .*--profile tools run --rm migrate\\n$`));
        if (db === "mongo") assert.match(call, / -f compose\.db\.yaml -f compose\.mongo-migrate\.yaml --profile tools run --rm migrate\n$/);
        else assert.doesNotMatch(call, /mongo-migrate/);
      }
    });
  }
});

describe("spring stack.json (mongo-support S9)", () => {
  it("lists mongo in dbs and its name says Spring Data MongoDB is available (only after scripts/e2e.sh spring mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/spring/stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "mongo"]);
    assert.match(stack.name, /Spring Data MongoDB/);
  });
});
