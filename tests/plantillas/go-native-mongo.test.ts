import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: go-native (net/http) with the official MongoDB driver (go.mongodb.org/mongo-driver/v2). The scripts run offline
// here, with a fake docker; the real proof (make new-app, make dev, make migrate against MongoDB) is
// `scripts/e2e.sh go-native mongo`. gin-mongo.test.ts holds the same checks for Gin.
const STACK = "go-native";
const SKILL = "gonative-scaffold";
const TPL = join(REPO, "plantillas/stacks", STACK);
const MONGO_SETUP = `.agents/skills/${SKILL}/scripts/mongo-setup.sh`;
const SCAFFOLD = `.agents/skills/${SKILL}/scripts/scaffold.sh`;
const ASSETS = join(TPL, "skills", SKILL, "assets/mongo");
const SQL_REQUIRES = ["github.com/go-sql-driver/mysql", "github.com/jackc/pgx/v5", "github.com/pressly/goose/v3", "modernc.org/sqlite"];
const KEPT_REQUIRES = ["github.com/redis/go-redis/v9 v9.23.0"];
// Starter files the Mongo variant replaces (from assets/mongo) or removes.
const REPLACED = [
  "cmd/api/main.go",
  "internal/platform/config/config.go",
  "internal/platform/db/db.go",
  "internal/platform/db/db_test.go",
  "internal/platform/db/errors.go",
];
const ADDED = ["internal/platform/db/indexes.go"];
const REMOVED = ["internal/platform/db/migrate.go", "migrations/migrations.go"];
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los modelos (internal/<m>/model.go) y make migrate los crea\n";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const code = (src: string) => src.replace(/^\s*\/\/.*$/gm, ""); // without comments

/** A go-native project after init, with the database activated by infra-setup ("none": no database). */
function project(db: "mongo" | "postgres" | "sqlite" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", STACK]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
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

/** A directory with fake executables that log their calls to `calls.log`. */
function fakeBin(names: string[]): { path: string; calls: () => string } {
  const bin = scratch();
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe(`mongo-setup.sh on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: go.mod requires mongo-driver v2.9.2 instead of the SQL libraries; the rest stays", () => {
    const d = project("mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const mod = read(d, "go.mod");
    assert.match(mod, /^\tgo\.mongodb\.org\/mongo-driver\/v2 v2\.9\.2$/m);
    assert.doesNotMatch(mod, /Module boundary/, "the assets' go.mod (a module boundary for basekit-go) was copied");
    for (const m of SQL_REQUIRES) assert.ok(!mod.includes(`\t${m} `), `${m} stayed in go.mod`);
    assert.doesNotMatch(mod, /mongo-driver\/v2 v[0-9.]+ \/\/ indirect/, "the old indirect line stayed");
    for (const m of KEPT_REQUIRES) assert.ok(mod.includes(`\t${m}\n`), `${m} was dropped`);
    assert.match(mod, /^tool honnef\.co\/go\/tools\/cmd\/staticcheck$/m);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(mongo-driver v2\)/);
  });

  it("with the MongoDB overlay: the platform code is the MongoDB variant and goose's files are gone", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    for (const f of [...REPLACED, ...ADDED]) assert.equal(read(d, f), readFileSync(join(ASSETS, f), "utf8"), f);
    for (const f of REMOVED) assert.ok(!existsSync(join(d, f)), `${f} stayed`);
    assert.ok(!existsSync(join(d, "migrations")), "migrations/ stayed");
    const config = read(d, "internal/platform/config/config.go");
    assert.match(config, /URL:\s+os\.Getenv\("MONGO_URL"\)/);
    assert.match(config, /MONGO_URL no está definida/);
    const db = read(d, "internal/platform/db/db.go");
    assert.match(db, /mongo\.Connect\(options\.Client\(\)\.ApplyURI\(c\.URL\)/);
    assert.match(db, /client\.Ping\(/);
    assert.match(db, /func NewID\(\) string \{ return uuid\.New\(\)\.String\(\) \}/);
    assert.doesNotMatch(db, /gorm|database\/sql/);
    assert.match(read(d, "internal/platform/db/errors.go"), /func IsUniqueViolation\(err error\) bool \{ return mongo\.IsDuplicateKeyError\(err\) \}/);
    const indexes = code(read(d, "internal/platform/db/indexes.go"));
    assert.match(indexes, /\.CreateMany\(ctx, c\.Indexes\)/);
    assert.doesNotMatch(indexes, /Drop/, "indexes.go can drop an index");
    const main = read(d, "cmd/api/main.go");
    assert.match(main, /if cfg\.Env != "prod" \{\n\s+if err := db\.EnsureIndexes\(ctx, database, collections\(\), os\.Stdout\)/, "dev startup indexes");
    assert.match(main, /return db\.EnsureIndexes\(ctx, database, collections\(\), os\.Stdout\)\n\}/, "migrate creates the indexes");
    assert.doesNotMatch(main, /goose|migrations\.FS/);
    assert.doesNotMatch(code(read(d, "internal/platform/db/db_test.go")), /MONGO_URL/, "a test reaches a real database");
  });

  it("is idempotent: a second run changes nothing", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(r.stdout, /^ {2}[~+-] /m, r.stdout);
  });

  for (const db of ["postgres", "sqlite", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing (database/sql stays)`, () => {
      const d = project(db);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("never deletes SQL migrations: with a .sql file in migrations/ it stops and changes nothing", () => {
    const d = project("mongo");
    writeFileSync(join(d, "migrations/20261101120000_create_orders.sql"), "-- +goose Up\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: migrations\/ tiene migraciones SQL/);
    assert.deepEqual(tree(d), before);
  });

  for (const f of ["cmd/api/main.go", "internal/platform/db/migrate.go"]) {
    it(`never overwrites a file you changed (${f}): it stops, names the file and changes nothing`, () => {
      const d = project("mongo");
      appendFileSync(join(d, f), "\n// mine\n");
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.match(r.stdout, /ERROR: .*cambiaron respecto al esqueleto de basekit/);
      assert.ok(r.stdout.includes(`  ${f}\n`), r.stdout);
      assert.deepEqual(tree(d), before);
    });
  }

  it("knows the untouched starter: its checksums are the ones of plantillas/stacks/<stack>/starter", () => {
    const script = readFileSync(join(TPL, "skills", SKILL, "scripts/mongo-setup.sh"), "utf8");
    for (const f of [...REPLACED, ...REMOVED]) {
      assert.ok(script.includes(`${f}) echo ${sha256(join(TPL, "starter", f))} ;;`), `stale checksum for ${f}`);
    }
  });
});

describe(`make new-app on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: applies the MongoDB variant before go mod tidy", () => {
    const d = project("mongo");
    const bin = scratch();
    // The fake docker records whether go.mod already required mongo-driver when `go mod tidy` ran.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s | %s\\n' "$*" "$(grep -c '^.go.mongodb.org/mongo-driver/v2 v2.9.2$' go.mod)" >> "${bin}/calls.log"\n`, {
      mode: 0o755,
    });
    const r = sh("make", ["new-app"], d, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(bin, "calls.log"), "utf8"), /go mod tidy \| 1\n$/);
  });

  it("with the PostgreSQL overlay: the same output as before (only go mod tidy; the starter stays)", () => {
    const d = project("postgres");
    const before = tree(d);
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /mongo-setup/);
    assert.match(fake.calls(), /go mod tidy\n$/);
    assert.deepEqual(tree(d), before);
  });

  it("without the skills folder: a SQL project still runs go mod tidy; a MongoDB one stops before it", () => {
    for (const db of ["postgres", "mongo"] as const) {
      const d = project(db);
      rmSync(join(d, ".agents"), { recursive: true, force: true });
      const fake = fakeBin(["docker"]);
      const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      if (db === "postgres") {
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.match(fake.calls(), /go mod tidy\n$/);
      } else {
        assert.notEqual(r.code, 0, r.stdout + r.stderr);
        assert.match(r.stdout, new RegExp(`ERROR: falta ${MONGO_SETUP} \\(skill ${SKILL}\\)`));
        assert.equal(fake.calls(), "");
      }
    }
  });
});

describe(`scaffold.sh on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: model.go holds a bson-tagged struct with a UUID string _id and its declared indexes", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const r = sh("bash", [SCAFFOLD, "orders"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "internal/orders/model.go");
    assert.match(model, /^package orders$/m);
    assert.match(model, /^const CollectionName = "orders"$/m);
    assert.match(model, /^type Orders struct \{\n\tID string `bson:"_id"` \/\/ db\.NewID\(\): UUID string$/m);
    assert.match(model, /^var Indexes = db\.Collection\{Name: CollectionName, Indexes: \[\]mongo\.IndexModel\{/m);
    assert.match(model, /Contrato: docs\/specs\/orders_contract\.md § data-writer\./);
    assert.match(read(d, "internal/orders/repository.go"), /Repositorio MongoDB de orders/);
    assert.match(r.stdout, /^Índices \(orquestador, cmd\/api\/main\.go, lista collections\):\n {2}orders\.Indexes,$/m);
    assert.doesNotMatch(r.stdout, /make migration/);
  });

  it("with the MongoDB overlay: the contract keeps the MongoDB section, drops the SQL one and every marker", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Colección `orders` \(MongoDB, `model\.go`, `Indexes`\)$/m);
    assert.match(contract, /^\| _id \| string \(UUID, `db\.NewID\(\)`\) \| no \| PK \|$/m);
    assert.match(contract, /^### Repositorio \(`MongoRepository`, implementa `Repository`\)$/m);
    assert.doesNotMatch(contract, /### Tabla|SQLRepository|SQLite/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: the same files, contract and output as before", () => {
    const d = project("postgres");
    const r = sh("bash", [SCAFFOLD, "orders"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(
      read(d, "internal/orders/model.go"),
      "// Modelo de orders (struct plano; el esquema lo fija la migración). Contrato: docs/specs/orders_contract.md § data-writer.\npackage orders\n",
    );
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Tabla `orders` \(migración SQL que crea el orquestador\)$/m);
    assert.match(contract, /^### Repositorio \(`SQLRepository` sobre `db\.Querier`, implementa `Repository`; SQL con `\?`\)$/m);
    assert.match(contract, /^- Repositorio sobre SQLite en memoria con el SQL de la migración$/m);
    assert.doesNotMatch(contract, /MongoDB|Colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
    assert.match(r.stdout, /^Migración \(orquestador\): make migration NAME=create_orders$/m);
  });
});

describe(`migrations and lint on ${STACK} (mongo-support S9)`, () => {
  it("with MongoDB, make migration only prints that there are no migrations: no NAME check, no container", () => {
    const d = project("mongo");
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

  it("with PostgreSQL, make migration still checks NAME and runs api migration in the app container", () => {
    const d = project("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.equal(fake.calls(), "");
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app go run \.\/cmd\/api migration create_orders$/m);
  });

  it("make lint checks gofmt on migrations/ only while it exists (SQL), never on a missing folder (MongoDB)", () => {
    for (const [db, dirs] of [["postgres", "cmd internal migrations"], ["mongo", "cmd internal"]] as const) {
      const d = project(db);
      assert.equal(sh("make", ["env"], d).code, 0);
      const fake = fakeBin(["docker"]);
      const r = sh("make", ["lint"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.ok(fake.calls().includes(`gofmt -l ${dirs}); [`), `${db}: ${fake.calls()}`);
    }
  });

  it("the migrate service runs `api migrate`, which in the MongoDB variant creates the indexes (dev and prod)", () => {
    assert.match(read(TPL, "files/compose.dev.yaml"), /command: \["go", "run", "\.\/cmd\/api", "migrate"\]/);
    assert.match(read(TPL, "files/compose.prod.yaml"), /command: \["migrate"\]/);
    assert.match(readFileSync(join(ASSETS, "cmd/api/main.go"), "utf8"), /case "migrate":\n\t\treturn migrate\(ctx, args\)/);
  });
});

describe(`${STACK} stack.json (mongo-support S9)`, () => {
  it("lists mongo in dbs and its name says mongo-driver is available (only after scripts/e2e.sh go-native mongo passed)", () => {
    const stack = JSON.parse(read(TPL, "stack.json"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /mongo-driver/);
  });
});
