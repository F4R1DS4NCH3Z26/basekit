import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: Laravel with mongodb/laravel-mongodb. The scripts run offline here, with a fake docker; the real
// proof (make new-app, make dev, make migrate against MongoDB) is `scripts/e2e.sh laravel mongo` plus a manual module.
const MONGO_SETUP = ".agents/skills/php-scaffold/scripts/mongo-setup.sh";
const SCAFFOLD = ".agents/skills/php-scaffold/scripts/scaffold.sh";
const STARTER_EXT = "RUN install-php-extensions pdo_pgsql pdo_mysql pdo_sqlite intl zip opcache bcmath pcntl redis \\";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

// The part of Laravel 12's config/database.php that mongo-setup.sh edits (the real file has more connections).
const DATABASE_PHP = `<?php

use Illuminate\\Support\\Str;

return [

    'default' => env('DB_CONNECTION', 'sqlite'),

    'connections' => [

        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DB_URL'),
        ],

    ],

];
`;

/** A Laravel project after init, with the database activated by infra-setup ("none": no database). */
function laravelProject(db: "mongo" | "postgres" | "sqlite" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "laravel"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
  return d;
}

/** The files `make new-app` leaves (composer create-project), faked: artisan, composer.json, config/database.php. */
function fakeApp(d: string): void {
  writeFileSync(join(d, "artisan"), "#!/usr/bin/env php\n<?php\n");
  writeFileSync(join(d, "composer.json"), '{\n    "require": {\n        "laravel/framework": "^12.0"\n    }\n}\n');
  mkdirSync(join(d, "config"), { recursive: true });
  writeFileSync(join(d, "config/database.php"), DATABASE_PHP);
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
function fakeBin(names: string[], body = ""): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n${body}`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe("laravel mongo-setup.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: the pinned extension in the image, the mongodb connection from MONGO_URL and the exact packages", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    const fake = fakeBin(["docker"]);
    const r = sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const dockerfile = read(d, "Dockerfile");
    assert.ok(dockerfile.includes(STARTER_EXT.replace(" \\", " mongodb-2.5.5 \\")), dockerfile);
    assert.ok(!dockerfile.includes(STARTER_EXT), "the starter extension line stayed");
    const db = read(d, "config/database.php");
    assert.match(db, /^ {8}'mongodb' => \[\n {12}'driver' => 'mongodb',\n {12}'dsn' => env\('MONGO_URL'\),\n {12}'database' => env\('DB_DATABASE', 'app'\),\n {8}\],$/m);
    assert.ok(db.indexOf("'mongodb' =>") < db.indexOf("'sqlite' =>"), "the connection goes inside 'connections'");
    assert.ok(db.includes(DATABASE_PHP.split("    'connections' => [\n")[1] ?? "-"), "the existing connections changed");
    const calls = fake.calls();
    assert.match(calls, /^docker run .*-e COMPOSER_AUTH .*composer:2 sh -c /m);
    assert.match(calls, /composer config platform\.ext-mongodb 2\.5\.5 && /);
    assert.match(calls, /composer require --no-interaction --no-scripts -W mongodb\/laravel-mongodb:5\.12\.0 mongodb\/mongodb:2\.5\.0$/m);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(laravel-mongodb\)/);
  });

  it("writes migration stubs whose up() creates indexes and whose down() never drops the collection", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    const fake = fakeBin(["docker"]);
    assert.equal(sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` }).code, 0);
    for (const stub of ["migration.stub", "migration.create.stub", "migration.update.stub"]) {
      const text = read(d, `stubs/${stub}`);
      assert.match(text, /^use MongoDB\\Laravel\\Schema\\Blueprint;$/m, stub);
      assert.doesNotMatch(text, /dropIfExists|->drop\(|Schema::drop/, `${stub} can drop a collection`);
    }
    const create = read(d, "stubs/migration.create.stub");
    assert.match(create, /Schema::table\('\{\{ table \}\}', function \(Blueprint \$collection\): void \{/);
    assert.match(create, /\/\/ \$collection->index\('owner_id'\);/);
    assert.match(create, /\/\/ \$collection->dropIndex\(\['owner_id'\]\);/);
  });

  it("is idempotent: a second run changes nothing and does not call composer again", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    const fake = fakeBin(["docker"]);
    assert.equal(sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` }).code, 0);
    // What the real composer require leaves in composer.json.
    writeFileSync(join(d, "composer.json"), read(d, "composer.json").replace('"^12.0"', '"^12.0",\n        "mongodb/laravel-mongodb": "5.12.0"'));
    const before = tree(d);
    const again = fakeBin(["docker"]);
    const r = sh("bash", [MONGO_SETUP], d, { PATH: `${again.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.equal(again.calls(), "");
    assert.doesNotMatch(r.stdout, /^ {2}[~+-] /m, r.stdout);
  });

  for (const db of ["postgres", "sqlite", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing`, () => {
      const d = laravelProject(db);
      fakeApp(d);
      const before = tree(d);
      const fake = fakeBin(["docker"]);
      const r = sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
      assert.equal(fake.calls(), "");
    });
  }

  it("only an exact DB_DRIVER: mongodb counts (mongodbx is not MongoDB)", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    writeFileSync(join(d, "compose.db.yaml"), read(d, "compose.db.yaml").replace("DB_DRIVER: mongodb", "DB_DRIVER: mongodbx"));
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.stdout + r.stderr, "");
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(sh("make", ["-n", "_new-app"], d).stdout, /mongo-setup/);
  });

  it("never overwrites a Dockerfile you changed: it stops, says what to add and changes nothing", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    writeFileSync(join(d, "Dockerfile"), read(d, "Dockerfile").replace(" redis \\", " redis gd \\"));
    const before = tree(d);
    const fake = fakeBin(["docker"]);
    const r = sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: el Dockerfile no tiene la línea install-php-extensions del kit; no se toca\./);
    assert.match(r.stdout, /Agrega mongodb-2\.5\.5 a install-php-extensions/);
    assert.deepEqual(tree(d), before);
    assert.equal(fake.calls(), "");
  });

  it("never overwrites a migration stub you wrote: it stops and changes nothing", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    mkdirSync(join(d, "stubs"));
    writeFileSync(join(d, "stubs/migration.create.stub"), "<?php // mine\n");
    const before = tree(d);
    const fake = fakeBin(["docker"]);
    const r = sh("bash", [MONGO_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: stubs\/migration\.create\.stub ya existe con otro contenido; no se pisa\./);
    assert.deepEqual(tree(d), before);
    assert.equal(fake.calls(), "");
  });
});

describe("make new-app on Laravel (mongo-support S9)", () => {
  it("with the MongoDB overlay: runs mongo-setup.sh after creating the app", () => {
    const d = laravelProject("mongo");
    fakeApp(d); // what the faked composer create-project would have left
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const calls = fake.calls().split("\n").filter(Boolean);
    assert.equal(calls.length, 2, fake.calls());
    assert.match(calls[0] ?? "", /composer create-project laravel\/laravel/);
    assert.match(calls[1] ?? "", /composer require .*mongodb\/laravel-mongodb:5\.12\.0/);
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(laravel-mongodb\)/);
  });

  it("with the MongoDB overlay: a failing MongoDB step fails make new-app and says how to retry", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    writeFileSync(join(d, "Dockerfile"), "FROM php:8.3\n");
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /ERROR: falló el paso de MongoDB; corrige y vuelve a ejecutar: bash \.agents\/skills\/php-scaffold\/scripts\/mongo-setup\.sh/);
  });

  for (const db of ["postgres", "none"] as const) {
    it(`with ${db === "none" ? "no database" : "PostgreSQL"}: only composer create-project, as before (also without the skills folder)`, () => {
      const d = laravelProject(db);
      rmSync(join(d, ".agents/skills/php-scaffold"), { recursive: true });
      const fake = fakeBin(["docker"]);
      const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(fake.calls().split("\n").filter(Boolean).length, 1);
      assert.doesNotMatch(r.stdout + fake.calls(), /mongo/i);
      assert.ok(read(d, "Dockerfile").includes(STARTER_EXT), "the SQL image changed");
    });
  }
});

describe("laravel scaffold.sh (mongo-support S9)", () => {
  it("with the MongoDB overlay: a laravel-mongodb model with a UUID _id on the module's collection", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    const r = sh("bash", [SCAFFOLD, "OrderItems"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "src/Modules/OrderItems/Domain/Models/OrderItems.php");
    assert.match(model, /^namespace App\\Modules\\OrderItems\\Domain\\Models;$/m);
    assert.match(model, /^use MongoDB\\Laravel\\Eloquent\\Model;$/m);
    assert.match(model, /^class OrderItems extends Model$/m);
    assert.match(model, /^ {4}use HasUuids;$/m);
    assert.match(model, /^ {4}protected \$connection = 'mongodb';$/m);
    assert.match(model, /^ {4}protected \$table = 'order_items';$/m);
    assert.match(model, /Contrato: docs\/specs\/order-items_contract\.md § data-writer/);
  });

  it("with the MongoDB overlay: the contract keeps the collection section, drops the table one and every marker", () => {
    const d = laravelProject("mongo");
    fakeApp(d);
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Colección `orders` \(MongoDB, `Domain\/Models\/Orders\.php`\)$/m);
    assert.match(contract, /^\| _id \| string \(UUID, HasUuids\) \| no \| PK \|$/m);
    assert.match(contract, /make migration NAME=create_orders_indexes/);
    assert.doesNotMatch(contract, /### Tabla|foreignId/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with PostgreSQL: no model file and the table contract, without markers", () => {
    const d = laravelProject("postgres");
    fakeApp(d);
    assert.equal(sh("bash", [SCAFFOLD, "Orders"], d).code, 0);
    assert.ok(!existsSync(join(d, "src/Modules/Orders/Domain/Models/Orders.php")));
    assert.ok(existsSync(join(d, "src/Modules/Orders/Domain/Models/.gitkeep")));
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(
      contract,
      /^## data-writer\n### Tabla `orders`\n\| Columna \| Tipo \| Nulo \| Índice \/ FK \|\n\|---\|---\|---\|---\|\n\| id \| uuid \| no \| PK \|\n\| owner_id \| foreignId\(users\) \| no \| index, cascadeOnDelete \|\n\n- `\$fillable`:$/m,
    );
    assert.doesNotMatch(contract, /MongoDB|Colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe("migrations on Laravel with MongoDB (mongo-support S9)", () => {
  it("make migrate still runs php artisan migrate (in MongoDB the migrations create the indexes)", () => {
    const compose = readFileSync(join(REPO, "plantillas/stacks/laravel/files/compose.yaml"), "utf8");
    assert.match(compose, /^ {4}command: \["php", "artisan", "migrate", "--force"\]$/m);
  });

  it("make migration still checks NAME and runs php artisan make:migration (with the Mongo stubs)", () => {
    const d = laravelProject("mongo");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    const ok = sh("make", ["migration", "NAME=create_orders_indexes"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app php artisan make:migration create_orders_indexes$/m);
  });
});

describe("laravel stack.json (mongo-support S9)", () => {
  it("lists mongo in dbs and its name says laravel-mongodb is available (only after scripts/e2e.sh laravel mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/laravel/stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /laravel-mongodb/);
  });
});
