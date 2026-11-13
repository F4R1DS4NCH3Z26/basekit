import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: python-native (stdlib WSGI) with PyMongo, in S7's shape and with S8's guards. The scripts run offline
// here, with a fake docker; the real proof (make new-app, make dev, make test, make migrate against MongoDB) is `scripts/e2e.sh python-native mongo`.
const STACK = "python-native";
const SKILL = "pynative-scaffold";
const MONGO_SETUP = `.agents/skills/${SKILL}/scripts/mongo-setup.sh`;
const SCAFFOLD = `.agents/skills/${SKILL}/scripts/scaffold.sh`;
const TPL = join(REPO, "plantillas/stacks", STACK);
// Every starter file the PyMongo variant replaces or removes.
const REPLACED = ["pyproject.toml", "src/core/config.py", "src/core/db.py", "src/core/wsgi.py", "src/main.py", "conftest.py", "alembic.ini", "alembic/env.py"];
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los módulos (INDEXES en src/modules/<m>/models.py) y make migrate los crea\n";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A python-native project after init, with the database activated by infra-setup ("none": no database). */
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
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe(`mongo-setup.sh on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: PyMongo at an exact version instead of SQLAlchemy, Alembic and the SQL drivers", () => {
    const d = project("mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const py = read(d, "pyproject.toml");
    assert.match(py, /^ {4}"pymongo==4\.19\.0",$/m);
    assert.doesNotMatch(py, /sqlalchemy|alembic|psycopg|pymysql/i, "a SQL dependency or Alembic setting stayed");
    assert.match(py, /"mongomock==4\.3\.0"/, "the in-memory MongoDB for the tests");
    assert.match(py, /^module = \["mongomock\.\*"\]$/m, "mongomock has no type hints: mypy strict needs the override");
    assert.ok(!existsSync(join(d, "alembic")), "alembic/ stayed");
    assert.ok(!existsSync(join(d, "alembic.ini")), "alembic.ini stayed");
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(PyMongo\)/);
  });

  it("with the MongoDB overlay: MONGO_URL settings, a lazy client, create-only indexes and an in-memory conftest", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const config = read(d, "src/core/config.py");
    assert.match(config, /mongo_url: str \| None = field\(default_factory=lambda: _env\("MONGO_URL"\) or None\)/);
    assert.doesNotMatch(config, /database_url|sqlalchemy/i);
    const db = read(d, "src/core/db.py");
    assert.match(db, /raise RuntimeError\(\s*"MONGO_URL no está definida/);
    assert.match(db, /\.create_indexes\(indexes\)/);
    assert.match(db, /@lru_cache\ndef default_database\(\)/, "the client is created on first use, never on import");
    assert.match(db, /if get_settings\(\)\.app_env != "prod":\n\s+create_indexes\(database\)/, "dev creates the indexes, prod does not");
    assert.doesNotMatch(db.replace(/^\s*#.*$/gm, ""), /drop_index/, "the app can drop indexes");
    assert.doesNotMatch(db, /sqlalchemy/i);
    assert.match(db, /^def get_db\(request: Request\) -> Database\[Any\]:$/m, "routes still get the database from the request");
    assert.match(read(d, "src/main.py"), /return App\(router, get_settings\(\)\.cors_list, database\)/);
    const wsgi = read(d, "src/core/wsgi.py");
    assert.match(wsgi, /request\.state\[DATABASE_KEY\] = self\.database/);
    assert.doesNotMatch(wsgi, /session_factory|SessionFactory/, "the WSGI app still expects a SQLAlchemy session factory");
    const indexes = read(d, "src/core/create_indexes.py");
    assert.match(indexes, /create_indexes\(client\.get_default_database\(\)\)/);
    assert.doesNotMatch(indexes.replace(/^\s*#.*$/gm, "").replace(/"""[\s\S]*?"""/, ""), /drop/i, "the script can drop indexes");
    assert.match(indexes, /create_indexes OK: \{len\(done\)\} colecciones/);
    const conftest = read(d, "conftest.py");
    assert.match(conftest, /mongomock\.MongoClient\(tz_aware=True\)/);
    assert.doesNotMatch(conftest, /sqlalchemy|MONGO_URL/i, "the tests reach a real database");
  });

  it("the PyMongo pyproject.toml is derived from the starter's: every line that is not SQL-specific is kept (S8.5)", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const mongo = read(d, "pyproject.toml").split("\n");
    const starter = readFileSync(join(TPL, "starter/pyproject.toml"), "utf8").split("\n");
    const sqlOnly = /sqlalchemy|alembic|psycopg|pymysql|^dev = /i;
    for (const l of starter.filter((l) => !sqlOnly.test(l))) assert.ok(mongo.includes(l), `starter line dropped: ${l}`);
    const script = readFileSync(join(TPL, `skills/${SKILL}/scripts/mongo-setup.sh`), "utf8");
    assert.doesNotMatch(script, /gunicorn==|\[tool\.ruff\]/, "mongo-setup.sh holds a hand copy of the starter's pyproject.toml");
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
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing (SQLAlchemy stays)`, () => {
      const d = project(db);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("never deletes Alembic migrations: with a revision in alembic/versions it stops and changes nothing", () => {
    const d = project("mongo");
    writeFileSync(join(d, "alembic/versions/20261101_abc_create_orders.py"), "# revision\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: alembic\/versions tiene migraciones/);
    assert.deepEqual(tree(d), before);
  });
});

describe(`mongo-setup.sh on ${STACK} never overwrites a changed file (mongo-support S8.1)`, () => {
  for (const f of REPLACED) {
    it(`stops and changes nothing when ${f} is no longer the untouched starter`, () => {
      const d = project("mongo");
      writeFileSync(join(d, f), read(d, f) + "# a change of mine\n");
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.match(r.stdout, /^ERROR: estos archivos ya no son los del esqueleto de basekit y no se sobrescriben:$/m);
      assert.match(r.stdout, new RegExp(`^ {2}${f.replaceAll(".", "\\.")}$`, "m"));
      assert.deepEqual(tree(d), before);
    });
  }

  it("stops and changes nothing when alembic/ holds a file the starter does not have", () => {
    const d = project("mongo");
    writeFileSync(join(d, "alembic/README"), "notes\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^ {2}alembic\/README$/m);
    assert.deepEqual(tree(d), before);
  });

  it("an untouched starter file next to one that already holds the PyMongo variant: replaces the first, keeps the second", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const mongoMain = read(d, "src/main.py") + "# included routers\n";
    writeFileSync(join(d, "src/main.py"), mongoMain);
    writeFileSync(join(d, "src/core/config.py"), readFileSync(join(TPL, "starter/src/core/config.py"), "utf8"));
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(read(d, "src/main.py"), mongoMain);
    assert.match(read(d, "src/core/config.py"), /mongo_url: str \| None = field\(default_factory=lambda: _env\("MONGO_URL"\) or None\)/);
  });

  it("with thousands of Alembic revisions it still stops (no find | grep -q under pipefail, S8.4)", () => {
    const d = project("mongo");
    const long = "x".repeat(60);
    for (let i = 0; i < 3000; i++) writeFileSync(join(d, `alembic/versions/${String(i).padStart(4, "0")}_${long}.py`), "");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: alembic\/versions tiene migraciones/);
    assert.ok(existsSync(join(d, "alembic.ini")));
    assert.match(read(d, "pyproject.toml"), /"sqlalchemy==/);
  });
});

describe(`make new-app on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: applies the PyMongo variant before uv lock", () => {
    const d = project("mongo");
    const bin = scratch();
    // The fake docker records whether PyMongo was already in pyproject.toml when `uv lock` ran.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s | %s\\n' "$*" "$(grep -c pymongo pyproject.toml)" >> "${bin}/calls.log"\n`, {
      mode: 0o755,
    });
    const r = sh("make", ["new-app"], d, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(bin, "calls.log"), "utf8"), /uv lock \| 1\n$/);
  });

  it("with the PostgreSQL overlay: the same output as before (only uv lock)", () => {
    const d = project("postgres");
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^docker run --rm .* uv lock\nuv\.lock creado\. Siguiente: make env && make dev\n$/);
    assert.match(fake.calls(), /uv lock\n$/);
    assert.ok(existsSync(join(d, "alembic.ini")));
    assert.match(read(d, "pyproject.toml"), /"sqlalchemy==2\.1\.6"/);
  });

  it("a SQL project without the scaffold skill still runs uv lock (S8.5)", () => {
    const d = project("postgres");
    rmSync(join(d, `.agents/skills/${SKILL}`), { recursive: true });
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(fake.calls(), /uv lock\n$/);
  });

  it("a MongoDB project without the scaffold skill fails before uv lock with a clear message", () => {
    const d = project("mongo");
    rmSync(join(d, `.agents/skills/${SKILL}`), { recursive: true });
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, new RegExp(`^ERROR: falta \\.agents/skills/${SKILL}/scripts/mongo-setup\\.sh`, "m"));
    assert.equal(fake.calls(), "");
    assert.ok(!existsSync(join(d, "uv.lock")));
  });
});

describe(`scaffold.sh on ${STACK} (mongo-support S9)`, () => {
  it("with the MongoDB overlay: models.py declares the collection, its indexes and the document type", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const r = sh("bash", [SCAFFOLD, "order_items"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "src/modules/order_items/models.py");
    assert.match(model, /^COLLECTION = "order_items"$/m);
    assert.match(model, /^INDEXES: list\[IndexModel\] = \[\]$/m);
    assert.match(model, /^class OrderItemsDocument\(TypedDict\):\n {4}_id: str/m);
    assert.match(model, /^def collection\(db: Database\[Any\]\) -> Collection\[OrderItemsDocument\]:$/m);
    assert.match(model, /Contrato: docs\/specs\/order_items_contract\.md § data-writer\./);
  });

  it("with the MongoDB overlay: the contract keeps the PyMongo section, drops the SQL one and every marker", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Colección `orders` \(PyMongo, `models\.py`: `COLLECTION`, `INDEXES` y `OrdersDocument`\)$/m);
    assert.match(contract, /^\| _id \| str \(UUID\) \| no \| PK \|$/m);
    assert.match(contract, /^- `def create_orders\(db: Database\[Any\], data: OrdersCreate, owner_id: str\) -> OrdersDocument:`$/m);
    assert.doesNotMatch(contract, /### Tabla|db: Session/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: docstring-only models.py and the SQL contract as before, without markers", () => {
    const d = project("postgres");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    assert.equal(read(d, "src/modules/orders/models.py"), '"""Modelos SQLAlchemy de orders.\n\nContrato: docs/specs/orders_contract.md § data-writer.\n"""\n');
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^## data-writer\n### Tabla `orders`\n/m);
    assert.match(contract, /^- `def create_orders\(db: Session, data: OrdersCreate, owner_id: UUID\) -> Orders:`$/m);
    assert.doesNotMatch(contract, /PyMongo|Colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe(`one MongoDB detection on ${STACK} (mongo-support S8.3)`, () => {
  // The same exact match in stack.mk ($$ is make's escape for $), mongo-setup.sh and scaffold.sh.
  const MATCH = "^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$";
  it("stack.mk, mongo-setup.sh and scaffold.sh hold the same exact DB_DRIVER match", () => {
    assert.ok(readFileSync(join(TPL, "files/.make/stack.mk"), "utf8").includes(`'${MATCH.replace("$", () => "$$")}'`), "stack.mk");
    for (const s of ["mongo-setup.sh", "scaffold.sh"]) {
      assert.ok(readFileSync(join(TPL, `skills/${SKILL}/scripts/${s}`), "utf8").includes(`'${MATCH}'`), s);
    }
  });

  /** What each of the three tools decides for a compose.db.yaml whose DB_DRIVER line is `line`. */
  function decisions(line: string) {
    const d = project("mongo");
    const yaml = read(d, "compose.db.yaml").replace(/^ {2}DB_DRIVER: mongodb$/m, line);
    assert.notEqual(yaml, read(d, "compose.db.yaml"));
    writeFileSync(join(d, "compose.db.yaml"), yaml);
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const migration = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    const setup = sh("bash", [MONGO_SETUP], d);
    assert.equal(setup.code, 0, setup.stdout + setup.stderr);
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    return {
      stackMk: migration.stdout === MIGRATION_LINE,
      mongoSetup: /pymongo/.test(read(d, "pyproject.toml")),
      scaffold: /^COLLECTION = /m.test(read(d, "src/modules/orders/models.py")),
    };
  }

  it("`DB_DRIVER: mongodbfoo` is not MongoDB for any of them", () => {
    assert.deepEqual(decisions("  DB_DRIVER: mongodbfoo"), { stackMk: false, mongoSetup: false, scaffold: false });
  });

  it("`DB_DRIVER: mongodb` with trailing spaces is MongoDB for all of them", () => {
    assert.deepEqual(decisions("  DB_DRIVER: mongodb  "), { stackMk: true, mongoSetup: true, scaffold: true });
  });
});

describe(`migrations on ${STACK} (mongo-support S9)`, () => {
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

  it("with PostgreSQL, make migration still checks NAME and runs alembic revision in the app container", () => {
    const d = project("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.equal(fake.calls(), "");
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app alembic revision --autogenerate -m create_orders$/m);
  });

  // The migrate service's command, as Compose passes it to `sh -c` ($$ is Compose's escape for $).
  const compose = readFileSync(join(TPL, "files/compose.yaml"), "utf8");
  const line = /^\s*command: (\[.*\])\s*$/m.exec(compose.slice(compose.indexOf("  migrate:")))?.[1];
  const migrateScript = (JSON.parse(line ?? "[]") as string[])[2]?.replaceAll("$$", "$") ?? "";

  /** Runs the migrate command in a directory holding `files`, with fake alembic and python. */
  function migrate(files: string[]) {
    const d = scratch();
    for (const f of files) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "");
    }
    const fake = fakeBin(["alembic", "python"]);
    const r = sh("sh", ["-c", migrateScript], d, { PATH: `${fake.path}:${process.env.PATH}` });
    return { ...r, calls: fake.calls() };
  }

  it("make migrate with PyMongo creates the declared indexes; with Alembic it upgrades", () => {
    assert.ok(migrateScript, "no sh -c migrate command in compose.yaml");
    const mongo = migrate(["src/core/create_indexes.py"]);
    assert.equal(mongo.code, 0, mongo.stdout + mongo.stderr);
    assert.equal(mongo.calls, "python -m src.core.create_indexes\n");
    const sql = migrate(["alembic.ini", "src/core/db.py"]);
    assert.equal(sql.code, 0, sql.stdout + sql.stderr);
    assert.equal(sql.calls, "alembic upgrade head\n");
  });

  it("make migrate without alembic.ini or the index script fails with a clear message and runs nothing (S8.2)", () => {
    const none = migrate([]);
    assert.equal(none.code, 1, none.stdout + none.stderr);
    assert.equal(none.calls, "");
    assert.equal(none.stdout, "");
    assert.equal(
      none.stderr,
      "ERROR: sin alembic.ini (SQLAlchemy) ni src/core/create_indexes.py (MongoDB) no hay migraciones que aplicar: ejecuta make new-app\n",
    );
  });
});

describe(`${STACK} stack.json (mongo-support S9)`, () => {
  it("lists mongo in dbs and its name says PyMongo is available (only after scripts/e2e.sh python-native mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(TPL, "stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /PyMongo/);
  });
});
