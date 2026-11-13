import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: Next.js with Mongoose. The scripts run offline here, with fake npm/npx/docker; the real proof
// (make new-app, make dev, make migrate against MongoDB) is `scripts/e2e.sh nextjs mongo` plus a feature by hand.
const APP_SETUP = ".agents/skills/nextjs-scaffold/scripts/app-setup.sh";
const SCAFFOLD = ".agents/skills/nextjs-scaffold/scripts/scaffold.sh";
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los modelos (src/features/<f>/model.ts) y make migrate los crea\n";
const tpl = (f: string) => readFileSync(join(REPO, "plantillas/stacks/nextjs", f), "utf8");
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A directory with fake executables that log their calls to `calls.log`. */
function fakeBin(names: string[]): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

/** A Next.js project after init, with the database activated by infra-setup ("none": no database). */
function project(db: "mongo" | "postgres" | "none", app = true): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "nextjs"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
  if (app) {
    // What create-next-app leaves behind, enough for app-setup.sh and scaffold.sh.
    writeFileSync(join(d, "package.json"), '{ "name": "app", "dependencies": { "next": "16.4.3" } }\n');
    mkdirSync(join(d, "src/app"), { recursive: true });
  }
  return d;
}

function appSetup(d: string) {
  const fake = fakeBin(["npm", "npx"]);
  const r = sh("bash", [APP_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}`, npm_config_before: "2026-01-01T00:00:00.000Z" });
  return { ...r, calls: fake.calls() };
}

describe("app-setup.sh on Next.js (mongo-support S9)", () => {
  it("with the MongoDB overlay: installs mongoose and tsx (exact) and connects from MONGO_URL when the server starts", () => {
    const d = project("mongo");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(
      r.calls,
      "npm install --no-audit --no-fund --save-exact mongoose@9.11.4\nnpm install --no-audit --no-fund --save-exact -D tsx@4.23.15\n",
    );
    const db = read(d, "src/lib/db.ts");
    assert.match(db, /const uri = process\.env\.MONGO_URL;/);
    assert.match(db, /throw new Error\("Falta MONGO_URL: activa la BD con la skill infra-setup y ejecuta make env"\)/);
    assert.match(db, /autoIndex = process\.env\.NODE_ENV !== "production"/);
    assert.match(db, /cache\.mongoConnection \?\?= /, "one connection per process, also across hot reloads");
    assert.doesNotMatch(db, /^import "server-only"/m, "make migrate imports db.ts outside Next.js");
    const inst = read(d, "src/instrumentation.ts");
    assert.match(inst, /export async function register\(\)/);
    assert.match(inst, /process\.env\.NEXT_RUNTIME === "nodejs"/);
    assert.match(inst, /await connectDb\(\);/);
    assert.match(r.stdout, /^app-setup OK: MongoDB \(Mongoose 9\.11\.4\)$/m);
  });

  it("with the MongoDB overlay: sync-indexes.ts loads every feature model and only creates indexes", () => {
    const d = project("mongo");
    assert.equal(appSetup(d).code, 0);
    const script = read(d, "src/lib/sync-indexes.ts");
    const code = script.replace(/^\s*\/\/.*$/gm, ""); // the comment explains how to drop an index by hand
    assert.match(code, /"model\.ts"/);
    assert.match(code, /await connectDb\(false\)/);
    assert.match(code, /await model\.createIndexes\(\)/);
    assert.doesNotMatch(code, /syncIndexes|dropIndex|cleanIndexes/, "the script can drop indexes");
    assert.match(script, /`sync-indexes OK: \$\{models\.length\} modelos`/);
  });

  it("with the MongoDB overlay: an instrumentation.ts of yours is kept, and the script says what to add", () => {
    const d = project("mongo");
    writeFileSync(join(d, "src/instrumentation.ts"), "export function register() {}\n");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(read(d, "src/instrumentation.ts"), "export function register() {}\n");
    assert.match(r.stdout, /AVISO: src\/instrumentation\.ts ya existe: .*connectDb/);
  });

  it("with the MongoDB overlay: a second run keeps everything (idempotent)", () => {
    const d = project("mongo");
    assert.equal(appSetup(d).code, 0);
    writeFileSync(join(d, "package.json"), '{ "dependencies": { "mongoose": "9.11.4" }, "devDependencies": { "tsx": "4.23.15" } }\n');
    const before = read(d, "src/lib/db.ts");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.calls, "");
    assert.equal(read(d, "src/lib/db.ts"), before);
  });

  it("with PostgreSQL or without a database: does nothing", () => {
    for (const db of ["postgres", "none"] as const) {
      const d = project(db);
      const r = appSetup(d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.calls, "", db);
      assert.ok(!existsSync(join(d, "src/lib")), `${db}: src/lib was created`);
    }
  });
});

describe("make new-app on Next.js (mongo-support S9)", () => {
  it("with MongoDB: runs app-setup.sh with the exact Mongoose and tsx versions after the app exists", () => {
    const d = project("mongo", false);
    const dry = sh("make", ["-n", "_new-app"], d);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /-e MONGOOSE_VERSION="9\.11\.4" -e TSX_VERSION="4\.23\.15"/);
    assert.match(dry.stdout, /apk add --no-cache coreutils bash/);
    assert.ok(dry.stdout.indexOf("bash .agents/skills/nextjs-scaffold/scripts/app-setup.sh") > dry.stdout.indexOf("npm install --no-audit --no-fund zod server-only"));
  });

  it("with PostgreSQL: the same steps as before, without app-setup.sh", () => {
    const d = project("postgres", false);
    const dry = sh("make", ["-n", "_new-app"], d);
    assert.equal(dry.code, 0, dry.stderr);
    assert.doesNotMatch(dry.stdout, /app-setup\.sh|MONGOOSE_VERSION|apk add --no-cache coreutils bash/);
    assert.match(dry.stdout, /apk add --no-cache coreutils >\/dev\/null && /);
    assert.match(dry.stdout, /npm install --no-audit --no-fund -D vitest @testing-library\/react @testing-library\/jest-dom jsdom @types\/node@\^22 && \\\n\s+chown -R "\$UID_GID" \/work'/);
  });
});

describe("scaffold.sh on Next.js (mongo-support S9)", () => {
  it("with the MongoDB overlay: a Mongoose model with a UUID string _id, and services.ts connects before using it", () => {
    const d = project("mongo");
    const r = sh("bash", [SCAFFOLD, "order-items"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "src/features/order-items/model.ts");
    assert.match(model, /_id: \{ type: String, default: \(\) => randomUUID\(\) \}/);
    assert.match(model, /\{ collection: "order-items", timestamps: true, versionKey: false \}/);
    assert.match(model, /export const OrderItemsModel = model\("OrderItems", orderItemsSchema, undefined, \{ overwriteModels: true \}\);/);
    const services = read(d, "src/features/order-items/services.ts");
    assert.match(services, /^import "server-only";$/m);
    assert.match(services, /await connectDb\(\)/);
  });

  it("with the MongoDB overlay: the contract has the Mongoose model and no marker", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^- Modelo Mongoose `OrdersModel` \(`model\.ts`/m);
    assert.match(contract, /^\| _id \| String, default randomUUID\(\) \| no \| PK \|$/m);
    assert.doesNotMatch(contract, /Entidad \/ tabla/, "the SQL line stayed");
    assert.doesNotMatch(contract, /<!-- \/?(prisma|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: the same feature files and contract as before", () => {
    const d = project("postgres");
    assert.equal(sh("bash", [SCAFFOLD, "products"], d).code, 0);
    assert.ok(!existsSync(join(d, "src/features/products/model.ts")), "a Mongo model was created");
    assert.equal(read(d, "src/features/products/services.ts"), 'import "server-only";\n\n// Acceso a datos de products (solo servidor).\n');
    const contract = read(d, "docs/specs/products_contract.md");
    assert.match(contract, /^- Propósito \(1 línea\):\n- Entidad \/ tabla y campos \(nombre: tipo, nullable\):\n- Permisos:/m);
    assert.doesNotMatch(contract, /Mongoose|randomUUID/, "the Mongoose section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(prisma|mongo) -->/, "a marker stayed");
  });
});

describe("make migration and make migrate on Next.js (mongo-support S9)", () => {
  it("with MongoDB, make migration explains there are no migrations and exits 0 whatever NAME is, without docker", () => {
    const d = project("mongo", false);
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    for (const args of [[], ["NAME=create_orders"], ["NAME=Bad Name"]]) {
      const r = sh("make", ["migration", ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.equal(r.stdout + r.stderr, MIGRATION_LINE, args.join(" "));
    }
    assert.equal(fake.calls(), "");
  });

  it("with PostgreSQL, make migration still checks NAME and runs prisma migrate dev in the app container", () => {
    const d = project("postgres", false);
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app npx --no-install prisma migrate dev --name create_orders$/m);
  });

  /** The migrate command of compose.<env>.yaml, run in a directory holding `files` with a fake npx. */
  function migrate(env: "dev" | "prod", files: string[]) {
    const compose = tpl(`files/compose.${env}.yaml`);
    const line = /^\s*command: (\[.*\])\s*$/m.exec(compose.slice(compose.indexOf("  migrate:")))?.[1];
    const argv = JSON.parse(line ?? "[]") as string[];
    assert.equal(argv[0], "sh", `compose.${env}.yaml: ${line}`);
    const d = scratch();
    for (const f of files) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "");
    }
    const fake = fakeBin(["npx"]);
    const r = sh("sh", ["-c", argv[2]!.replaceAll("$$", "$")], d, { PATH: `${fake.path}:${process.env.PATH}` });
    return { ...r, calls: fake.calls() };
  }

  it("make migrate with Mongoose (dev and prod): runs the index script with tsx", () => {
    for (const env of ["dev", "prod"] as const) {
      const r = migrate(env, ["src/lib/sync-indexes.ts"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.calls, "npx --no-install tsx src/lib/sync-indexes.ts\n", env);
    }
  });

  it("make migrate keeps prisma migrate deploy without the index script (dev and prod)", () => {
    for (const env of ["dev", "prod"] as const) {
      const r = migrate(env, ["prisma/schema.prisma"]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(r.calls, "npx --no-install prisma migrate deploy\n", env);
    }
  });
});
