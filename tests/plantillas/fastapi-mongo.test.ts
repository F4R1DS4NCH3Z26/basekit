import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S7: FastAPI with Beanie. The scripts run offline here, with a fake docker; the real proof
// (make new-app, make dev, make test, make migrate against MongoDB) is `scripts/e2e.sh fastapi mongo`.
const MONGO_SETUP = ".agents/skills/py-scaffold/scripts/mongo-setup.sh";
const SCAFFOLD = ".agents/skills/py-scaffold/scripts/scaffold.sh";
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los modelos (src/modules/<m>/models.py) y make migrate los crea\n";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A FastAPI project after init, with the database activated by infra-setup ("none": no database). */
function fastapiProject(db: "mongo" | "postgres" | "sqlite" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "fastapi"]);
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

describe("mongo-setup.sh (mongo-support S7)", () => {
  it("with the MongoDB overlay: Beanie and PyMongo at exact versions instead of SQLAlchemy, Alembic and the SQL drivers", () => {
    const d = fastapiProject("mongo");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const py = read(d, "pyproject.toml");
    assert.match(py, /^ {4}"beanie==2\.2\.0",$/m);
    assert.match(py, /^ {4}"pymongo==4\.19\.0",$/m);
    assert.doesNotMatch(py, /sqlalchemy|alembic|psycopg|pymysql/i, "a SQL dependency or Alembic setting stayed");
    assert.match(py, /"pymongo-async-mock==0\.1\.3"/, "the in-memory MongoDB for the tests");
    assert.match(py, /"mongomock==4\.3\.0"/);
    assert.ok(!existsSync(join(d, "alembic")), "alembic/ stayed");
    assert.ok(!existsSync(join(d, "alembic.ini")), "alembic.ini stayed");
    assert.match(r.stdout, /mongo-setup OK: MongoDB \(Beanie\)/);
  });

  it("with the MongoDB overlay: MONGO_URL settings, Beanie in the lifespan, create-only indexes and an in-memory conftest", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const config = read(d, "src/core/config.py");
    assert.match(config, /mongo_url: str \| None = None/);
    assert.doesNotMatch(config, /database_url|sqlalchemy/i);
    const db = read(d, "src/core/db.py");
    assert.match(db, /await init_beanie\(/);
    assert.match(db, /allow_index_dropping=False/);
    assert.match(db, /raise RuntimeError\(\s*"MONGO_URL no está definida/);
    assert.match(db, /src\/modules\/\*\/models\.py/);
    assert.doesNotMatch(db, /sqlalchemy/i);
    const main = read(d, "src/main.py");
    assert.match(main, /lifespan=lifespan\(database\)/);
    const indexes = read(d, "src/core/create_indexes.py");
    const code = indexes.replace(/^\s*#.*$/gm, ""); // the comment explains how to drop an index by hand
    assert.match(code, /create_indexes=True/);
    assert.doesNotMatch(code, /drop_index|allow_index_dropping=True/, "the script can drop indexes");
    assert.match(indexes, /create_indexes OK: \{len\(models\)\} modelos/);
    const conftest = read(d, "conftest.py");
    assert.match(conftest, /from pymongo_async_mock import AsyncMongoMockClient/);
    assert.doesNotMatch(conftest, /sqlalchemy|MONGO_URL/i, "the tests reach a real database");
  });

  it("is idempotent: a second run changes nothing", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(tree(d), before);
    assert.doesNotMatch(r.stdout, /^ {2}[~+-] /m, r.stdout);
  });

  for (const db of ["postgres", "sqlite", "none"] as const) {
    it(`with ${db === "none" ? "no database" : `the ${db} overlay`}: changes nothing and prints nothing (SQLAlchemy stays)`, () => {
      const d = fastapiProject(db);
      const before = tree(d);
      const r = sh("bash", [MONGO_SETUP], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.stdout + r.stderr, "");
      assert.deepEqual(tree(d), before);
    });
  }

  it("never deletes Alembic migrations: with a revision in alembic/versions it stops and changes nothing", () => {
    const d = fastapiProject("mongo");
    writeFileSync(join(d, "alembic/versions/20261101_abc_create_orders.py"), "# revision\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: alembic\/versions tiene migraciones/);
    assert.deepEqual(tree(d), before);
  });
});

describe("make new-app on FastAPI (mongo-support S7)", () => {
  it("with the MongoDB overlay: applies the Beanie variant before uv lock", () => {
    const d = fastapiProject("mongo");
    const bin = scratch();
    // The fake docker records whether Beanie was already in pyproject.toml when `uv lock` ran.
    writeFileSync(join(bin, "docker"), `#!/bin/sh\nprintf '%s | %s\\n' "$*" "$(grep -c beanie pyproject.toml)" >> "${bin}/calls.log"\n`, {
      mode: 0o755,
    });
    const r = sh("make", ["new-app"], d, { PATH: `${bin}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(bin, "calls.log"), "utf8"), /uv lock \| 1\n$/);
  });

  it("with the PostgreSQL overlay: the same output as before (only uv lock)", () => {
    const d = fastapiProject("postgres");
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /mongo-setup/);
    assert.match(fake.calls(), /uv lock\n$/);
    assert.ok(existsSync(join(d, "alembic.ini")));
    assert.match(read(d, "pyproject.toml"), /"sqlalchemy==2\.1\.6"/);
  });
});

describe("scaffold.sh on FastAPI (mongo-support S7)", () => {
  it("with the MongoDB overlay: models.py holds a Beanie Document with a UUID string id", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const r = sh("bash", [SCAFFOLD, "order_items"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "src/modules/order_items/models.py");
    assert.match(model, /^class OrderItems\(Document\):$/m);
    assert.match(model, /id: str = Field\(default_factory=lambda: str\(uuid4\(\)\)\)/);
    assert.match(model, /name = "order_items"/);
    assert.match(model, /Contrato: docs\/specs\/order_items_contract\.md § data-writer\./);
  });

  it("with the MongoDB overlay: the contract keeps the Beanie section, drops the SQL one and every marker", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Colección `orders` \(Beanie, `models\.py`, clase `Orders`\)$/m);
    assert.match(contract, /^\| _id \| str \(UUID\) \| no \| PK \|$/m);
    assert.match(contract, /^- `async def create_orders\(data: OrdersCreate, owner_id: str\) -> Orders:`$/m);
    assert.doesNotMatch(contract, /### Tabla|db: Session/, "the SQL section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: docstring-only models.py and the SQL contract, without markers", () => {
    const d = fastapiProject("postgres");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    assert.equal(read(d, "src/modules/orders/models.py"), '"""Modelos ORM de orders.\n\nContrato: docs/specs/orders_contract.md § data-writer.\n"""\n');
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^### Tabla `orders`$/m);
    assert.match(contract, /^- `def create_orders\(db: Session, data: OrdersCreate, owner_id: UUID\) -> Orders:`$/m);
    assert.doesNotMatch(contract, /Beanie|Colección/, "the Mongo section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(sql|mongo) -->/, "a marker stayed");
  });
});

describe("migrations on FastAPI (mongo-support S7)", () => {
  it("with MongoDB, make migration only prints that there are no migrations: no NAME check, no container", () => {
    const d = fastapiProject("mongo");
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
    const d = fastapiProject("postgres");
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
  const compose = readFileSync(join(REPO, "plantillas/stacks/fastapi/files/compose.yaml"), "utf8");
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

  it("make migrate with Beanie creates the declared indexes; with Alembic it upgrades", () => {
    assert.ok(migrateScript, "no sh -c migrate command in compose.yaml");
    const mongo = migrate(["src/core/create_indexes.py"]);
    assert.equal(mongo.code, 0, mongo.stdout + mongo.stderr);
    assert.equal(mongo.calls, "python -m src.core.create_indexes\n");
    const sql = migrate(["alembic.ini", "src/core/db.py"]);
    assert.equal(sql.code, 0, sql.stdout + sql.stderr);
    assert.equal(sql.calls, "alembic upgrade head\n");
  });

  // mongo-support S8.2: nothing it can run is a failure, never a silent success.
  it("make migrate without alembic.ini or the index script fails with a clear message and runs nothing", () => {
    const none = migrate([]);
    assert.equal(none.code, 1, none.stdout + none.stderr);
    assert.equal(none.calls, "");
    assert.equal(none.stdout, "");
    assert.equal(
      none.stderr,
      "ERROR: falta alembic.ini (SQLAlchemy) y src/core/create_indexes.py (MongoDB): no hay migraciones que aplicar\n",
    );
  });
});

describe("mongo-setup.sh never overwrites a changed file (mongo-support S8.1)", () => {
  // Every starter file the Beanie variant replaces or removes.
  const replaced = ["pyproject.toml", "src/core/config.py", "src/core/db.py", "src/main.py", "conftest.py", "alembic.ini", "alembic/env.py"];
  for (const f of replaced) {
    it(`stops and changes nothing when ${f} is no longer the untouched starter`, () => {
      const d = fastapiProject("mongo");
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
    const d = fastapiProject("mongo");
    writeFileSync(join(d, "alembic/README"), "notes\n");
    const before = tree(d);
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /^ {2}alembic\/README$/m);
    assert.deepEqual(tree(d), before);
  });

  it("an untouched starter file next to one that already holds the Beanie variant: replaces the first, keeps the second", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const beanieMain = read(d, "src/main.py") + "# registered routers\n";
    writeFileSync(join(d, "src/main.py"), beanieMain);
    writeFileSync(join(d, "src/core/config.py"), readFileSync(join(REPO, "plantillas/stacks/fastapi/starter/src/core/config.py"), "utf8"));
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(read(d, "src/main.py"), beanieMain);
    assert.match(read(d, "src/core/config.py"), /mongo_url: str \| None = None/);
  });

  it("the Mongo pyproject.toml is derived from the starter's: every line that is not SQL-specific is kept (S8.5)", () => {
    const d = fastapiProject("mongo");
    assert.equal(sh("bash", [MONGO_SETUP], d).code, 0);
    const mongo = read(d, "pyproject.toml").split("\n");
    const starter = readFileSync(join(REPO, "plantillas/stacks/fastapi/starter/pyproject.toml"), "utf8").split("\n");
    const sqlOnly = /sqlalchemy|alembic|psycopg|pymysql|^dev = |^# Exact versions|^# the prod/i;
    for (const l of starter.filter((l) => !sqlOnly.test(l))) assert.ok(mongo.includes(l), `starter line dropped: ${l}`);
    const script = readFileSync(join(REPO, "plantillas/stacks/fastapi/skills/py-scaffold/scripts/mongo-setup.sh"), "utf8");
    assert.doesNotMatch(script, /fastapi\[standard\]==|\[tool\.ruff\]/, "mongo-setup.sh still holds a hand copy of the starter's pyproject.toml");
  });
});

describe("mongo-setup.sh guards (mongo-support S8.4)", () => {
  it("with thousands of Alembic revisions it still stops (no find | grep -q under pipefail)", () => {
    const d = fastapiProject("mongo");
    const long = "x".repeat(60);
    for (let i = 0; i < 3000; i++) writeFileSync(join(d, `alembic/versions/${String(i).padStart(4, "0")}_${long}.py`), "");
    const r = sh("bash", [MONGO_SETUP], d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: alembic\/versions tiene migraciones/);
    assert.ok(existsSync(join(d, "alembic.ini")));
    assert.match(read(d, "pyproject.toml"), /"sqlalchemy==/);
  });
});

describe("one MongoDB detection (mongo-support S8.3)", () => {
  // The same exact match in stack.mk ($$ is make's escape for $), mongo-setup.sh and scaffold.sh.
  const MATCH = "^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$";
  it("stack.mk, mongo-setup.sh and scaffold.sh hold the same exact DB_DRIVER match", () => {
    const base = join(REPO, "plantillas/stacks/fastapi");
    assert.ok(readFileSync(join(base, "files/.make/stack.mk"), "utf8").includes(`'${MATCH.replace("$", () => "$$")}'`), "stack.mk");
    for (const s of ["mongo-setup.sh", "scaffold.sh"]) {
      assert.ok(readFileSync(join(base, `skills/py-scaffold/scripts/${s}`), "utf8").includes(`'${MATCH}'`), s);
    }
  });

  /** What each of the three tools decides for a compose.db.yaml whose DB_DRIVER line is `line`. */
  function decisions(line: string) {
    const d = fastapiProject("mongo");
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
      mongoSetup: /beanie/.test(read(d, "pyproject.toml")),
      scaffold: /\(Document\)/.test(read(d, "src/modules/orders/models.py")),
    };
  }

  it("`DB_DRIVER: mongodbfoo` is not MongoDB for any of them", () => {
    assert.deepEqual(decisions("  DB_DRIVER: mongodbfoo"), { stackMk: false, mongoSetup: false, scaffold: false });
  });

  it("`DB_DRIVER: mongodb` with trailing spaces is MongoDB for all of them", () => {
    assert.deepEqual(decisions("  DB_DRIVER: mongodb  "), { stackMk: true, mongoSetup: true, scaffold: true });
  });
});

describe("make new-app and make migration robustness (mongo-support S8.5)", () => {
  it("a SQL project without the py-scaffold skill still runs uv lock", () => {
    const d = fastapiProject("postgres");
    rmSync(join(d, ".agents/skills/py-scaffold"), { recursive: true });
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(fake.calls(), /uv lock\n$/);
  });

  it("a MongoDB project without the py-scaffold skill fails before uv lock with a clear message", () => {
    const d = fastapiProject("mongo");
    rmSync(join(d, ".agents/skills/py-scaffold"), { recursive: true });
    const fake = fakeBin(["docker"]);
    const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /^ERROR: falta \.agents\/skills\/py-scaffold\/scripts\/mongo-setup\.sh/m);
    assert.equal(fake.calls(), "");
    assert.ok(!existsSync(join(d, "uv.lock")));
  });

  // stack.mk's Mongo override (`migration: DC = @echo …; :`) only works while the core recipe keeps this shape:
  // the NAME check through MIGRATION_NAME_CHECK, then a line that starts with $(DC).
  it("the core Makefile's migration recipe keeps the shape stack.mk's DC override relies on", () => {
    const core = readFileSync(join(REPO, "plantillas/core/Makefile"), "utf8").split("\n");
    const at = core.findIndex((l) => l.startsWith("migration:"));
    assert.ok(at > 0);
    const recipe = core.slice(at + 1).filter((_, i, all) => all.slice(0, i + 1).every((l) => l.startsWith("\t")));
    assert.deepEqual(recipe, ["\t@$(if $(NO_DB_MSG),:,$(MIGRATION_NAME_CHECK))", "\t$(DC) run --rm -e NAME $(APP) $(MAKE_MIGRATION_CMD)"]);
  });
});

describe("fastapi stack.json (mongo-support S7)", () => {
  it("lists mongo in dbs and its name says Beanie is available (only after scripts/e2e.sh fastapi mongo passed)", () => {
    const stack = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/fastapi/stack.json"), "utf8"));
    assert.deepEqual(stack.dbs, ["postgres", "mysql", "sqlite", "mongo"]);
    assert.match(stack.name, /Beanie/);
  });
});
