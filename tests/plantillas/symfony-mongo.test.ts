import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: Symfony with Doctrine MongoDB ODM. The scripts run offline here, with a fake docker; the real proof
// (make new-app, make dev, make migrate against MongoDB, a module writing and reading) is `scripts/e2e.sh symfony mongo`
// plus a manual module.
const MONGO_SETUP = ".agents/skills/symfony-scaffold/scripts/mongo-setup.sh";
const SCAFFOLD = ".agents/skills/symfony-scaffold/scripts/scaffold.sh";
const STARTER_EXT = "RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache redis \\";
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los documentos (src/Modules/<M>/Domain/Entity/) y make migrate los crea\n";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A Symfony project after init, with the database activated by infra-setup ("none": no database). */
function symfonyProject(db: "mongo" | "postgres" | "sqlite" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "symfony"]);
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

describe("symfony mongo-setup.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: adds the pinned mongodb extension to the starter's install-php-extensions line", () => {
    const d = symfonyProject("mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const dockerfile = read(d, "Dockerfile");
    assert.ok(dockerfile.includes(STARTER_EXT.replace(" \\", " mongodb-2.5.5 \\")), dockerfile);
    assert.ok(!dockerfile.includes(STARTER_EXT), "the starter extension line stayed");
    assert.match(r.stdout, /^ {2}~ Dockerfile \(extensión mongodb-2\.5\.5\)$/m);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(Doctrine MongoDB ODM\)/);
  });

  it("is idempotent: a second run changes nothing", () => {
    const d = symfonyProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(r.stdout, /^ {2}[~+-] /m, r.stdout);
  });

  for (const db of ["postgres", "sqlite", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing`, () => {
      const d = symfonyProject(db);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("only an exact DB_DRIVER: mongodb counts (mongodbx is not MongoDB)", () => {
    const d = symfonyProject("mongo");
    writeFileSync(join(d, "compose.db.yaml"), read(d, "compose.db.yaml").replace("DB_DRIVER: mongodb", "DB_DRIVER: mongodbx"));
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout + r.stderr, "");
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(sh("make", ["-n", "_new-app"], d).stdout, /mongo|config-mongo/);
  });

  it("never overwrites a Dockerfile you changed: it stops, says what to add and changes nothing", () => {
    const d = symfonyProject("mongo");
    writeFileSync(join(d, "Dockerfile"), read(d, "Dockerfile").replace(" redis \\", " redis gd \\"));
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca\./);
    assert.match(r.stdout, /Agrega mongodb-2\.5\.5 a install-php-extensions/);
    assert.deepEqual(tree(d), before);
  });
});

describe("make new-app on Symfony (mongo-support S9)", () => {
  it("with the MongoDB overlay: the ODM at exact versions instead of the ORM and Migrations, and setup.php config-mongo", () => {
    const d = symfonyProject("mongo");
    const dry = sh("make", ["-n", "_new-app"], d);
    assert.equal(dry.code, 0, dry.stderr);
    const out = dry.stdout;
    assert.ok(out.indexOf("mongo-setup.sh") >= 0 && out.indexOf("mongo-setup.sh") < out.indexOf("docker run"), "the Dockerfile is checked first");
    assert.match(
      out,
      /composer require --no-interaction --no-scripts --ignore-platform-req=ext-\* doctrine\/mongodb-odm-bundle:5\.6\.1 doctrine\/mongodb-odm:2\.17\.4 mongodb\/mongodb:2\.5\.0 symfony\/security-bundle:7\.4\.\* /,
    );
    assert.doesNotMatch(out, /doctrine\/orm|doctrine\/doctrine-bundle|doctrine-migrations-bundle/);
    assert.match(out, /php \/work\/\.make\/symfony\/setup\.php config-mongo \/work\/\.env\.example;/);
    assert.match(out, /\/tmp\/app\/src\/Repository \/tmp\/app\/src\/Document;/);
  });

  it("with the MongoDB overlay: a Dockerfile it cannot change stops make new-app before creating the app", () => {
    const d = symfonyProject("mongo");
    writeFileSync(join(d, "Dockerfile"), "FROM php:8.3\n");
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /ERROR: el Dockerfile no tiene la línea install-php-extensions del kit/);
    assert.equal(fake.calls(), "", "composer ran");
  });

  for (const db of ["postgres", "none"] as const) {
    it(`with ${db === "none" ? "no database" : "PostgreSQL"}: the ORM and Migrations as before (also without the skills folder)`, () => {
      const d = symfonyProject(db);
      rmSync(join(d, ".agents/skills/symfony-scaffold"), { recursive: true });
      const out = sh("make", ["-n", "_new-app"], d).stdout;
      assert.match(out, /--ignore-platform-req=ext-\* doctrine\/doctrine-bundle:\^2\.13 doctrine\/doctrine-migrations-bundle:\^3\.4 doctrine\/orm:\^3\.3 symfony\/security-bundle/);
      assert.match(out, /php \/work\/\.make\/symfony\/setup\.php config \/work\/\.env\.example;/);
      assert.match(out, /\/tmp\/app\/src\/Repository;/);
      assert.doesNotMatch(out, /mongo/i);
      const fake = fakeBin(["docker"]);
      const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(fake.calls().split("\n").filter(Boolean).length, 1);
      assert.ok(read(d, "Dockerfile").includes(STARTER_EXT), "the SQL image changed");
    });
  }

  it("setup.php config-mongo points the ODM at MONGO_URL and DB_DATABASE and never copies the recipe's MONGODB_URI", () => {
    const setup = readFileSync(join(REPO, "plantillas/stacks/symfony/files/.make/symfony/setup.php"), "utf8");
    assert.match(setup, /^ {20}server: '%env\(MONGO_URL\)%'$/m);
    assert.match(setup, /^ {12}default_database: '%env\(DB_DATABASE\)%'$/m);
    assert.match(setup, /dir: '%kernel\.project_dir%\/src\/Modules'/);
    assert.match(setup, /\$skip = \[\.\.\.\$skip, 'MONGODB_URI', 'MONGODB_DB'\];/);
  });
});

describe("symfony scaffold.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: an ODM document with a UUID string id on the module's collection", () => {
    const d = symfonyProject("mongo");
    writeFileSync(join(d, "composer.json"), "{}\n");
    const r = sh("bash", [SCAFFOLD, "OrderItems"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const doc = read(d, "src/Modules/OrderItems/Domain/Entity/OrderItems.php");
    assert.match(doc, /^namespace App\\Modules\\OrderItems\\Domain\\Entity;$/m);
    assert.match(doc, /^use Doctrine\\ODM\\MongoDB\\Mapping\\Attribute as ODM;$/m);
    assert.match(doc, /^#\[ODM\\Document\(collection: 'order_items'\)\]$/m);
    assert.match(doc, /^ {4}#\[ODM\\Id\(type: 'string', strategy: 'NONE'\)\]$/m);
    assert.match(doc, /\$this->id = Uuid::v7\(\)->toRfc4122\(\);/);
    assert.match(doc, /Contrato: docs\/specs\/order-items_contract\.md § data-writer/);
  });

  it("with the MongoDB overlay: the contract keeps the document section, drops the table one and every marker", () => {
    const d = symfonyProject("mongo");
    writeFileSync(join(d, "composer.json"), "{}\n");
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Documento `Orders` → colección `orders` \(Doctrine MongoDB ODM, `Domain\/Entity\/Orders\.php`\)$/m);
    assert.match(contract, /^\| id \| string \(UUID, strategy NONE\) \| no \| PK \(`_id`\) \|$/m);
    assert.doesNotMatch(contract, /→ tabla|ManyToOne/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with PostgreSQL: no document file and the entity contract, without markers", () => {
    const d = symfonyProject("postgres");
    writeFileSync(join(d, "composer.json"), "{}\n");
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    assert.ok(!existsSync(join(d, "src/Modules/Orders/Domain/Entity/Orders.php")));
    assert.ok(existsSync(join(d, "src/Modules/Orders/Domain/Entity/.gitkeep")));
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(
      contract,
      /^## data-writer\n### Entidad `Orders` → tabla `orders`\n\| Campo \| Tipo Doctrine \| Nulo \| Índice \/ relación \|\n\|---\|---\|---\|---\|\n\| id \| uuid \(Symfony Uid\) \| no \| PK \|\n\| owner \| ManyToOne\(User\) \| no \| index, onDelete CASCADE \|\n\n- Campos que asigna el servidor/m,
    );
    assert.doesNotMatch(contract, /MongoDB|colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe("migrations on Symfony (mongo-support S9)", () => {
  it("with MongoDB, make migration only prints that there are no migrations: no NAME check, no container", () => {
    const d = symfonyProject("mongo");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    for (const args of [[], ["NAME=create_orders"], ["NAME=Bad Name"]]) {
      const r = sh("make", ["migration", ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, MIGRATION_LINE, args.join(" "));
    }
    assert.equal(fake.calls(), "");
  });

  it("with PostgreSQL, make migration still checks NAME and runs doctrine:migrations:diff in the app container", () => {
    const d = symfonyProject("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.equal(fake.calls(), "");
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app php bin\/console doctrine:migrations:diff --no-interaction --allow-empty-diff$/m);
  });

  // The migrate service's command, as Compose passes it to `sh -c`.
  const compose = readFileSync(join(REPO, "plantillas/stacks/symfony/files/compose.yaml"), "utf8");
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

  it("make migrate with the ODM creates the declared indexes only (never schema:update); with the ORM it runs the migrations", () => {
    assert.ok(migrateScript, "no sh -c migrate command in compose.yaml");
    const mongo = migrate(["config/packages/doctrine_mongodb.yaml"]);
    assert.equal(mongo.code, 0, mongo.stdout + mongo.stderr);
    assert.equal(mongo.calls, "php bin/console doctrine:mongodb:schema:create --index\n");
    const sql = migrate(["config/packages/doctrine.yaml"]);
    assert.equal(sql.code, 0, sql.stdout + sql.stderr);
    assert.equal(sql.calls, "php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration\n");
    assert.doesNotMatch(migrateScript, /schema:update|schema:drop/);
  });
});

describe("symfony stack.json (mongo-support S9)", () => {
  it("lists mongo in dbs and its name says Doctrine MongoDB ODM is available (only after scripts/e2e.sh symfony mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/symfony/stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /MongoDB ODM/);
  });
});
