import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: php-native with mongodb/mongodb. The scripts run offline here, with a fake docker; the real proof
// (make new-app, make dev, make migrate against MongoDB, a module writing and reading) is `scripts/e2e.sh php-native mongo`
// plus a manual module.
const MONGO_SETUP = ".agents/skills/phpnative-scaffold/scripts/mongo-setup.sh";
const SCAFFOLD = ".agents/skills/phpnative-scaffold/scripts/scaffold.sh";
const STARTER_EXT = "RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite opcache redis \\";
const MIGRATION_LINE = "MongoDB no tiene migraciones: los índices se declaran en src/Modules/<M>/Migrations/indexes.php y make migrate los crea\n";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A php-native project after init, with the database activated by infra-setup ("none": no database). */
function nativeProject(db: "mongo" | "postgres" | "sqlite" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "php-native"]);
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
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe("php-native mongo-setup.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: the pinned extension, mongodb/mongodb at an exact version, the Mongo service and the index script", () => {
    const d = nativeProject("mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const dockerfile = read(d, "Dockerfile");
    assert.ok(dockerfile.includes(STARTER_EXT.replace(" \\", " mongodb-2.5.5 \\")), dockerfile);
    assert.ok(!dockerfile.includes(STARTER_EXT), "the starter extension line stayed");
    const composer = JSON.parse(read(d, "composer.json"));
    assert.equal(composer.require["mongodb/mongodb"], "2.5.0");
    assert.equal(composer.require["ext-mongodb"], "*");
    assert.equal(composer.require["ext-pdo"], "*", "the starter's requirements changed");
    const mongo = read(d, "src/Core/Database/Mongo.php");
    assert.match(mongo, /\$this->env->get\('MONGO_URL'\) \?\? throw new \\RuntimeException\('MONGO_URL is missing/);
    assert.match(mongo, /\$client->getDatabase\(\$name\)/);
    const indexes = read(d, "bin/mongo-indexes.php");
    const code = indexes.replace(/^\s*\/\/.*$/gm, ""); // the comment explains how to drop an index by hand
    assert.match(code, /->createIndexes\(/);
    assert.doesNotMatch(code, /dropIndex|->drop\(/, "the script can drop indexes");
    assert.match(indexes, /src\/Modules\/\*\/Migrations\/indexes\.php/);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(mongodb\/mongodb\)/);
  });

  it("is idempotent: a second run changes nothing", () => {
    const d = nativeProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(r.stdout, /^ {2}[~+-] /m, r.stdout);
  });

  for (const db of ["postgres", "sqlite", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing`, () => {
      const d = nativeProject(db);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("only an exact DB_DRIVER: mongodb counts (mongodbx is not MongoDB)", () => {
    const d = nativeProject("mongo");
    writeFileSync(join(d, "compose.db.yaml"), read(d, "compose.db.yaml").replace("DB_DRIVER: mongodb", "DB_DRIVER: mongodbx"));
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout + r.stderr, "");
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(sh("make", ["-n", "_new-app"], d).stdout, /mongo/);
  });

  const refusals: [string, (d: string) => void, RegExp][] = [
    ["a Dockerfile", (d) => writeFileSync(join(d, "Dockerfile"), read(d, "Dockerfile").replace(" redis \\", " redis gd \\")), /ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca\./],
    ["composer.json", (d) => writeFileSync(join(d, "composer.json"), read(d, "composer.json").replace('"ext-pdo": "*"', '"ext-pdo": "*",\n        "ext-intl": "*"')), /ERROR: composer\.json no tiene la sección require del kit; no se toca\./],
    ["src/Core/Database/Mongo.php", (d) => writeFileSync(join(d, "src/Core/Database/Mongo.php"), "<?php // mine\n"), /ERROR: src\/Core\/Database\/Mongo\.php ya existe con otro contenido; no se pisa\./],
  ];
  for (const [what, change, message] of refusals) {
    it(`never overwrites ${what} you changed: it stops, says what to do and changes nothing`, () => {
      const d = nativeProject("mongo");
      change(d);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.match(r.stdout, message);
      assert.deepEqual(tree(d), before);
    });
  }
});

describe("make new-app on php-native (mongo-support S9)", () => {
  it("with the MongoDB overlay: applies the MongoDB variant before composer resolves the lock", () => {
    const d = nativeProject("mongo");
    const bin = scratch();
    // The fake docker records whether mongodb/mongodb was already in composer.json when composer ran.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s | %s\\n' "$*" "$(grep -c mongodb/mongodb composer.json)" >> "${bin}/calls.log"\n`, {
      mode: 0o755,
    });
    const r = sh("make", ["new-app"], d, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(bin, "calls.log"), "utf8"), /composer update .* \| 1\n$/);
  });

  it("with the MongoDB overlay: a refusal stops make new-app before composer runs", () => {
    const d = nativeProject("mongo");
    writeFileSync(join(d, "Dockerfile"), "FROM php:8.5\n");
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.equal(fake.calls(), "");
    assert.ok(!existsSync(join(d, "composer.lock")));
  });

  for (const db of ["postgres", "none"] as const) {
    it(`with ${db === "none" ? "no database" : "PostgreSQL"}: only composer update, as before (also without the skills folder)`, () => {
      const d = nativeProject(db);
      const composer = read(d, "composer.json");
      rmSync(join(d, ".agents/skills/phpnative-scaffold"), { recursive: true });
      const fake = fakeBin(["docker"]);
      const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(fake.calls(), /^docker run .* composer update --no-install --no-interaction --no-scripts --ignore-platform-req=ext-\*\n$/);
      assert.doesNotMatch(r.stdout, /mongo/i);
      assert.equal(read(d, "composer.json"), composer);
      assert.ok(read(d, "Dockerfile").includes(STARTER_EXT), "the SQL image changed");
      assert.ok(!existsSync(join(d, "src/Core/Database/Mongo.php")));
    });
  }
});

describe("php-native scaffold.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: the module's indexes.php and a repository on its collection", () => {
    const d = nativeProject("mongo");
    const r = sh("bash", [SCAFFOLD, "OrderItems"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const indexes = read(d, "src/Modules/OrderItems/Migrations/indexes.php");
    assert.match(indexes, /^ {4}'order_items' => \[$/m);
    assert.match(indexes, /\/\/ \['key' => \['owner_id' => 1\]\],/);
    const repo = read(d, "src/Modules/OrderItems/Domain/Repository/OrderItemsRepository.php");
    assert.match(repo, /^namespace App\\Modules\\OrderItems\\Domain\\Repository;$/m);
    assert.match(repo, /^use App\\Core\\Database\\Mongo;$/m);
    assert.match(repo, /\$mongo->collection\('order_items'\)/);
    assert.match(repo, /Contrato: docs\/specs\/order-items_contract\.md § data-writer/);
    assert.match(repo, /findOne\(\['_id' => \$id, 'owner_id' => \$ownerId\]\)/);
    for (const f of ["Migrations/indexes.php", "Domain/Repository/OrderItemsRepository.php"]) {
      assert.equal(statSync(join(d, "src/Modules/OrderItems", f)).mode & 0o777, 0o644, `${f} is not readable by the prod user`);
    }
  });

  it("with the MongoDB overlay: the contract keeps the collection section, drops the table one and every marker", () => {
    const d = nativeProject("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Colección `orders` \(MongoDB; índices en `src\/Modules\/Orders\/Migrations\/indexes\.php`\)$/m);
    assert.match(contract, /^\| _id \| string \(UUID v7\) \| no \| PK \|$/m);
    assert.doesNotMatch(contract, /### Tabla|CHAR\(36\)/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with PostgreSQL: no indexes.php nor repository and the table contract, without markers", () => {
    const d = nativeProject("postgres");
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    assert.ok(!existsSync(join(d, "src/Modules/Orders/Migrations/indexes.php")));
    assert.ok(!existsSync(join(d, "src/Modules/Orders/Domain/Repository/OrdersRepository.php")));
    assert.ok(existsSync(join(d, "src/Modules/Orders/Migrations/.gitkeep")));
    // The prod image runs as uid 1001: a 0600 file (mktemp's mode) would not be readable there.
    assert.equal(statSync(join(d, "src/Modules/Orders/Http/routes.php")).mode & 0o777, 0o644);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(
      contract,
      /^## data-writer\n### Tabla `orders` \(migración en `src\/Modules\/Orders\/Migrations\/`\)\n\| Columna \| Tipo SQL \(portable\) \| Nulo \| Índice \/ relación \|\n\|---\|---\|---\|---\|\n\| id \| CHAR\(36\) \(UUID v7\) \| no \| PK \|\n\| owner_id \| CHAR\(36\) \| no \| index, FK users\(id\) ON DELETE CASCADE \|\n\| created_at \| TIMESTAMP \(UTC\) \| no \| \|\n\n- Variantes por motor \(solo si hace falta\): `\.pgsql\.sql` \/ `\.mysql\.sql` \/ `\.sqlite\.sql`\n- Campos que asigna/m,
    );
    assert.doesNotMatch(contract, /MongoDB|Colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe("migrations on php-native (mongo-support S9)", () => {
  for (const target of ["migration", "module-migration"] as const) {
    it(`with MongoDB, make ${target} only prints that there are no migrations: no NAME check, no container`, () => {
      const d = nativeProject("mongo");
      assert.equal(sh("make", ["env"], d).code, 0);
      const fake = fakeBin(["docker"]);
      for (const args of [[], ["NAME=create_orders", "M=Orders"], ["NAME=Bad Name"]]) {
        const r = sh("make", [target, ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.equal(r.stdout + r.stderr, MIGRATION_LINE, args.join(" "));
      }
      assert.equal(fake.calls(), "");
    });
  }

  it("with PostgreSQL, make migration and make module-migration still check their input and run bin/migrate.php new", () => {
    const d = nativeProject("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const env = { PATH: `${fake.path}:${process.env.PATH}` };
    assert.equal(sh("make", ["migration", "NAME=x"], d, env).code, 2);
    const bad = sh("make", ["module-migration", "M=orders", "NAME=create_orders"], d, env);
    assert.equal(bad.code, 2, bad.stdout);
    assert.match(bad.stdout, /Uso: make module-migration M=Products NAME=create_products/);
    assert.equal(fake.calls(), "");
    assert.equal(sh("make", ["migration", "NAME=create_orders"], d, env).code, 0);
    assert.equal(sh("make", ["module-migration", "M=Orders", "NAME=create_orders"], d, env).code, 0);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app php bin\/migrate\.php new create_orders$/m);
    assert.match(fake.calls(), /^docker compose .* run --rm --no-deps -e M -e NAME app php bin\/migrate\.php new create_orders Orders$/m);
  });

  // The migrate service's command, as Compose passes it to `sh -c`.
  const compose = readFileSync(join(REPO, "plantillas/stacks/php-native/files/compose.yaml"), "utf8");
  const line = /^\s*command: (\[.*\])\s*$/m.exec(compose.slice(compose.indexOf("  migrate:")))?.[1];
  const migrateScript = (JSON.parse(line ?? "[]") as string[])[2]?.replaceAll("$$", "$") ?? "";

  /** Runs the migrate command in a directory holding `files`, with a fake php. */
  function migrate(files: string[]) {
    const d = scratch();
    for (const f of files) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "");
    }
    const fake = fakeBin(["php"]);
    const r = sh("sh", ["-c", migrateScript], d, { PATH: `${fake.path}:${process.env.PATH}` });
    return { ...r, calls: fake.calls() };
  }

  it("make migrate with MongoDB creates the declared indexes; with SQL it runs bin/migrate.php up", () => {
    assert.ok(migrateScript, "no sh -c migrate command in compose.yaml");
    const mongo = migrate(["bin/mongo-indexes.php", "bin/migrate.php"]);
    assert.equal(mongo.code, 0, mongo.stdout + mongo.stderr);
    assert.equal(mongo.calls, "php bin/mongo-indexes.php\n");
    const sql = migrate(["bin/migrate.php"]);
    assert.equal(sql.code, 0, sql.stdout + sql.stderr);
    assert.equal(sql.calls, "php bin/migrate.php up\n");
  });
});

describe("php-native stack.json (mongo-support S9)", () => {
  it("lists mongo in dbs and its name says mongodb/mongodb is available (only after scripts/e2e.sh php-native mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/php-native/stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /mongodb\/mongodb/);
  });
});
