import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S9: Express with Mongoose. The scripts run offline here, with fake npm/npx/docker; the real proof
// (make new-app, make dev, make migrate against MongoDB) is `scripts/e2e.sh express mongo` plus a module by hand.
const STACK = "express";
const APP_SETUP = ".agents/skills/express-scaffold/scripts/app-setup.sh";
const SCAFFOLD = ".agents/skills/express-scaffold/scripts/scaffold.sh";
const MIGRATION_LINE =
  "MongoDB no tiene migraciones: los índices se declaran en los modelos (src/modules/<m>/model.ts) y make migrate los crea\n";
const tpl = (f: string) => readFileSync(join(REPO, `plantillas/stacks/${STACK}`, f), "utf8");
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A directory with fake executables that log their calls to `calls.log`. */
function fakeBin(names: string[]): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

/** A project after init and the package.json of make new-app, with the database activated by infra-setup. */
function project(db: "mongo" | "postgres" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", STACK]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
  writeFileSync(join(d, "package.json"), '{ "name": "app", "type": "module", "dependencies": {} }\n');
  return d;
}

function appSetup(d: string) {
  const fake = fakeBin(["npm", "npx"]);
  const r = sh("bash", [APP_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}`, npm_config_before: "2026-01-01T00:00:00.000Z" });
  return { ...r, calls: fake.calls() };
}

describe("app-setup.sh on Express (mongo-support S9)", () => {
  it("with the MongoDB overlay: installs mongoose (exact), connects from MONGO_URL before listening, and no Prisma", () => {
    const d = project("mongo");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.calls, "npm install --no-audit --no-fund --save-exact mongoose@9.11.4\n");
    assert.ok(!existsSync(join(d, "prisma")), "prisma/ was created");
    assert.ok(!existsSync(join(d, "src/lib/db.ts")), "the Prisma client was created");
    const conn = read(d, "src/mongo/connection.ts");
    assert.match(conn, /const uri = process\.env\.MONGO_URL;/);
    assert.match(conn, /throw new Error\("Falta MONGO_URL: activa la BD con la skill infra-setup y ejecuta make env"\)/);
    assert.match(conn, /autoIndex = env\.NODE_ENV !== "production"/);
    const server = read(d, "src/server.ts");
    assert.ok(server.indexOf("await connectMongo();") >= 0, "server.ts does not connect");
    assert.ok(server.indexOf("await connectMongo();") < server.indexOf(".listen("), "server.ts listens before connecting");
    assert.match(server, /disconnectMongo/);
    assert.match(r.stdout, /^app-setup OK: MongoDB \(Mongoose 9\.11\.4\)$/m);
  });

  it("with the MongoDB overlay: sync-indexes.ts only creates the declared indexes (createIndexes, never a drop)", () => {
    const d = project("mongo");
    assert.equal(appSetup(d).code, 0);
    const script = read(d, "src/mongo/sync-indexes.ts");
    const code = script.replace(/^\s*\/\/.*$/gm, ""); // the comment explains how to drop an index by hand
    assert.match(code, /import "\.\.\/app\.js";/, "the models are registered by importing the app");
    assert.match(code, /await connectMongo\(false\)/);
    assert.match(code, /await model\.createIndexes\(\)/);
    assert.doesNotMatch(code, /syncIndexes|dropIndex|cleanIndexes/, "the script can drop indexes");
    assert.match(script, /`sync-indexes OK: \$\{models\.length\} modelos`/);
  });

  it("with the MongoDB overlay: a server.ts you changed stops the script before it changes anything", () => {
    const d = project("mongo");
    const mine = `${read(d, "src/server.ts")}// mío\n`;
    writeFileSync(join(d, "src/server.ts"), mine);
    const r = appSetup(d);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: src\/server\.ts no es el del kit/);
    assert.match(r.stdout, /await connectMongo\(\)/, "the message says what to add");
    assert.equal(r.calls, "", "npm ran");
    assert.equal(read(d, "src/server.ts"), mine);
    assert.ok(!existsSync(join(d, "src/mongo")), "src/mongo was created");
  });

  it("with the MongoDB overlay: a second run keeps everything (idempotent)", () => {
    const d = project("mongo");
    assert.equal(appSetup(d).code, 0);
    writeFileSync(join(d, "package.json"), '{ "dependencies": { "mongoose": "9.11.4" } }\n');
    const server = read(d, "src/server.ts");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(r.calls, "");
    assert.equal(read(d, "src/server.ts"), server);
    assert.match(r.stdout, /= src\/mongo\/connection\.ts/);
  });

  it("the checksum that recognizes the untouched server.ts is the starter's", () => {
    const want = /^STARTER_SERVER="([0-9]+ [0-9]+)"$/m.exec(tpl("skills/express-scaffold/scripts/app-setup.sh"))?.[1];
    const got = sh("sh", ["-c", "cksum < starter/src/server.ts"], join(REPO, `plantillas/stacks/${STACK}`)).stdout.trim();
    assert.equal(want, got);
  });

  it("with the PostgreSQL overlay: still Prisma with its adapter, and server.ts untouched", () => {
    const d = project("postgres");
    const server = read(d, "src/server.ts");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.calls, /^npm install --no-audit --no-fund --save-exact @prisma\/client@7\.10\.1$/m);
    assert.match(r.calls, /^npm install --no-audit --no-fund --save-exact @prisma\/adapter-pg@7\.10\.1$/m);
    assert.match(r.calls, /^npx --no-install prisma generate$/m);
    assert.doesNotMatch(r.calls, /mongoose/);
    assert.match(read(d, "src/lib/db.ts"), /new PrismaPg/);
    assert.equal(read(d, "src/server.ts"), server);
    assert.ok(!existsSync(join(d, "src/mongo")), "src/mongo was created");
  });

  it("without a database: neither Prisma nor Mongoose", () => {
    const d = project("none");
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.calls, /prisma|mongoose/);
    assert.match(r.stdout, /^app-setup OK$/m);
  });
});

describe("scaffold.sh on Express (mongo-support S9)", () => {
  it("with the MongoDB overlay: a Mongoose model with a UUID string _id, and the repository uses it", () => {
    const d = project("mongo");
    const r = sh("bash", [SCAFFOLD, "order-items"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const model = read(d, "src/modules/order-items/model.ts");
    assert.match(model, /_id: \{ type: String, default: \(\) => randomUUID\(\) \}/);
    assert.match(model, /\{ collection: "order-items", timestamps: true, versionKey: false \}/);
    assert.match(model, /export const OrderItemsModel = model\("OrderItems", orderItemsSchema\);/);
    const repo = read(d, "src/modules/order-items/repository.ts");
    assert.match(repo, /OrderItemsModel de \.\/model\.ts/);
    assert.doesNotMatch(repo, /db\(\)/);
  });

  it("with the MongoDB overlay: the contract keeps the Mongoose section, drops the Prisma one and every marker", () => {
    const d = project("mongo");
    assert.equal(sh("bash", [SCAFFOLD, "orders"], d).code, 0);
    const contract = read(d, "docs/specs/orders_contract.md");
    assert.match(contract, /^- Modelo Mongoose `OrdersModel` \(`model\.ts`/m);
    assert.match(contract, /^\| _id \| String, default randomUUID\(\) \| no \| PK \|$/m);
    assert.doesNotMatch(contract, /prisma\/schema\.prisma|@default\(uuid\(\)\)/, "the Prisma section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(prisma|mongo) -->/, "a marker stayed");
  });

  it("with the PostgreSQL overlay: the same module files as before, and the contract is the Prisma one", () => {
    const d = project("postgres");
    assert.equal(sh("bash", [SCAFFOLD, "products"], d).code, 0);
    assert.ok(!existsSync(join(d, "src/modules/products/model.ts")), "a Mongo model was created");
    assert.equal(
      read(d, "src/modules/products/repository.ts"),
      "// Acceso a datos de products: db() de src/lib/db.ts, siempre con select. Contrato: docs/specs/products_contract.md § data-writer\nexport {};\n",
    );
    const contract = read(d, "docs/specs/products_contract.md");
    assert.match(contract, /^- Modelo Prisma `Products` \(lo agrega el orquestador en `prisma\/schema\.prisma` antes de delegar\):$/m);
    assert.match(contract, /^\| id \| String @id @default\(uuid\(\)\) \| no \| PK \|$/m);
    assert.doesNotMatch(contract, /Mongoose|randomUUID/, "the Mongoose section stayed");
    assert.doesNotMatch(contract, /<!-- \/?(prisma|mongo) -->/, "a marker stayed");
  });
});

describe("make migration and make migrate on Express (mongo-support S9)", () => {
  it("with MongoDB, make migration explains there are no migrations and exits 0 whatever NAME is, without docker", () => {
    const d = project("mongo");
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
    const d = project("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.match(bad.stdout, /Uso: make migration NAME=snake_case/);
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app sh -c npx --no-install prisma migrate dev/m);
  });

  it("make new-app passes the exact Mongoose version to app-setup.sh", () => {
    const d = project("mongo");
    const dry = sh("make", ["-n", "_new-app"], d);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /-e MONGOOSE_VERSION="9\.11\.4"/);
  });

  // The migrate service's command, as Compose passes it to `sh -c` ($$ is Compose's escape for $).
  const compose = tpl("files/compose.yaml");
  const line = /^\s*command: (\[.*\])\s*$/m.exec(compose.slice(compose.indexOf("  migrate:")))?.[1];
  const migrateScript = (JSON.parse(line ?? "[]") as string[])[2]?.replaceAll("$$", "$") ?? "";

  /** Runs the migrate command in a directory holding `files`, with fake npx and node. */
  function migrate(files: string[], env: NodeJS.ProcessEnv = {}) {
    const d = scratch();
    for (const f of files) {
      mkdirSync(join(d, f, ".."), { recursive: true });
      writeFileSync(join(d, f), "");
    }
    const fake = fakeBin(["npx", "node"]);
    const r = sh("sh", ["-c", migrateScript], d, { PATH: `${fake.path}:${process.env.PATH}`, NODE_ENV: "", ...env });
    return { ...r, calls: fake.calls() };
  }

  it("make migrate with Mongoose in dev: runs the index script from the sources with tsx", () => {
    const dev = migrate(["src/mongo/sync-indexes.ts"], { NODE_ENV: "development" });
    assert.equal(dev.code, 0, dev.stdout + dev.stderr);
    assert.equal(dev.calls, "npx --no-install tsx src/mongo/sync-indexes.ts\n");
  });

  it("make migrate with Mongoose in prod (target build, already compiled): the compiled index script", () => {
    const prod = migrate(["src/mongo/sync-indexes.ts"], { NODE_ENV: "production" });
    assert.equal(prod.code, 0, prod.stdout + prod.stderr);
    assert.equal(prod.calls, "node dist/mongo/sync-indexes.js\n");
    assert.match(tpl("files/compose.prod.yaml").slice(tpl("files/compose.prod.yaml").indexOf("  migrate:")), /NODE_ENV: production/);
  });

  it("make migrate keeps prisma migrate deploy with a Prisma schema, and fails when there is nothing it can run", () => {
    const prisma = migrate(["prisma/schema.prisma"]);
    assert.equal(prisma.code, 0, prisma.stdout + prisma.stderr);
    assert.equal(prisma.calls, "npx --no-install prisma migrate deploy\n");
    const none = migrate([]);
    assert.notEqual(none.code, 0, "nothing to run must not be a success");
    assert.equal(none.calls, "");
    assert.equal(none.stderr, "Sin prisma/schema.prisma ni src/mongo/sync-indexes.ts: nada que migrar\n");
  });
});
