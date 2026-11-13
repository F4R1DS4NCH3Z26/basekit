import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, REPO, scratch, sh } from "../helpers.js";

after(cleanup);

// mongo-support S4: NestJS with @nestjs/mongoose. The scripts run offline here, with fake npm/npx/docker; the real
// proof (make new-app, make dev, make migrate against MongoDB) is `scripts/e2e.sh nestjs mongo`.
const APP_SETUP = ".agents/skills/nest-scaffold/scripts/app-setup.sh";
const SCAFFOLD = ".agents/skills/nest-scaffold/scripts/scaffold.sh";
const MIGRATION_MSG = /MongoDB no tiene migraciones: los índices se declaran en los modelos/;
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");

/** A directory with fake executables that log their calls to `calls.log`. */
function fakeBin(names: string[]): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

/** A NestJS project after init, with the database activated by infra-setup ("none": no database). */
function nestProject(db: "mongo" | "postgres" | "none"): string {
  const d = scratch();
  const r = basekit(["init", d, "--yes", "--no-external-skills", "--stack", "nestjs"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  if (db !== "none") {
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", db], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
  }
  return d;
}

/** What `nest new` leaves behind, enough for app-setup.sh and scaffold.sh. */
function fakeNestApp(d: string): void {
  writeFileSync(join(d, "package.json"), '{ "name": "app", "type": "module", "dependencies": {} }\n');
  writeFileSync(join(d, "nest-cli.json"), "{}\n");
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src/main.ts"), "// nest new\n");
  writeFileSync(join(d, "src/app.module.ts"), "// nest new\n");
}

function appSetup(d: string) {
  const fake = fakeBin(["npm", "npx"]);
  const r = sh("bash", [APP_SETUP], d, { PATH: `${fake.path}:${process.env.PATH}`, npm_config_before: "2026-01-01T00:00:00.000Z" });
  return { ...r, calls: fake.calls() };
}

describe("app-setup.sh (mongo-support S4)", () => {
  it("with the MongoDB overlay: installs @nestjs/mongoose and mongoose, wires MongooseModule.forRootAsync and no Prisma", () => {
    const d = nestProject("mongo");
    fakeNestApp(d);
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.calls, /^npm install --no-audit --no-fund --save-exact @nestjs\/mongoose@12 mongoose@9$/m);
    assert.doesNotMatch(r.calls, /prisma/, "no Prisma package and no prisma generate");
    assert.ok(!existsSync(join(d, "prisma")), "prisma/ was created");
    const mod = read(d, "src/mongo/mongo.module.ts");
    assert.match(mod, /MongooseModule\.forRootAsync\(/);
    assert.match(mod, /uri: requireEnv\('MONGO_URL'\)/);
    assert.match(mod, /autoIndex: process\.env\.NODE_ENV !== 'production'/);
    assert.match(mod, /throw new Error\(`Falta \$\{name\}/);
    assert.match(read(d, "src/mongo/sync-indexes.ts"), /\.syncIndexes\(\)/);
    const app = read(d, "src/app.module.ts");
    assert.match(app, /import \{ MongoModule \} from '\.\/mongo\/mongo\.module\.js';/);
    assert.match(app, /imports: \[MongoModule, HealthModule\]/);
    assert.match(r.stdout, /app-setup OK: \/health, MongoDB \(Mongoose\)/);
  });

  it("with the PostgreSQL overlay: still installs Prisma with its adapter and runs prisma generate", () => {
    const d = nestProject("postgres");
    fakeNestApp(d);
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.calls, /^npm install --no-audit --no-fund --save-exact @prisma\/client@7\.10\.1$/m);
    assert.match(r.calls, /^npm install --no-audit --no-fund --save-exact @prisma\/adapter-pg@7\.10\.1$/m);
    assert.match(r.calls, /^npx --no-install prisma generate$/m);
    assert.doesNotMatch(r.calls, /mongoose/);
    assert.match(read(d, "src/prisma/prisma.service.ts"), /new PrismaPg\(/);
    assert.match(read(d, "src/app.module.ts"), /imports: \[PrismaModule, HealthModule\]/);
    assert.ok(!existsSync(join(d, "src/mongo")), "src/mongo was created");
  });

  it("without a database: neither Prisma nor Mongoose", () => {
    const d = nestProject("none");
    fakeNestApp(d);
    const r = appSetup(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.calls, /prisma|mongoose/);
    assert.match(read(d, "src/app.module.ts"), /imports: \[HealthModule\]/);
    assert.match(r.stdout, /app-setup OK: \/health$/m);
  });
});

describe("scaffold.sh (mongo-support S4)", () => {
  it("with the MongoDB overlay: a @Schema model, a repository on the injected Model and MongooseModule.forFeature", () => {
    const d = nestProject("mongo");
    fakeNestApp(d);
    const r = sh("bash", [SCAFFOLD, "order-items"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const dir = "src/modules/order-items";
    const model = read(d, `${dir}/order-items.model.ts`);
    assert.match(model, /@Schema\(\{ collection: 'order-items', timestamps: true, versionKey: false \}\)/);
    assert.match(model, /export class OrderItemsEntity \{/);
    assert.match(model, /export const OrderItemsEntitySchema = SchemaFactory\.createForClass\(OrderItemsEntity\);/);
    const repo = read(d, `${dir}/order-items.repository.ts`);
    assert.match(repo, /@InjectModel\(OrderItemsEntity\.name\) private readonly model: Model<OrderItemsEntity>/);
    assert.doesNotMatch(repo, /Prisma/);
    const mod = read(d, `${dir}/order-items.module.ts`);
    assert.match(mod, /imports: \[MongooseModule\.forFeature\(\[\{ name: OrderItemsEntity\.name, schema: OrderItemsEntitySchema \}\]\)\]/);
    assert.match(mod, /providers: \[OrderItemsService, OrderItemsRepository\]/);
    assert.match(read(d, `${dir}/order-items.service.ts`), /constructor\(private readonly repository: OrderItemsRepository\)/);
    assert.match(read(d, "docs/specs/order-items_contract.md"), /Modelo Mongoose/);
  });

  it("with the PostgreSQL overlay: the Prisma repository, no model file and no forFeature", () => {
    const d = nestProject("postgres");
    fakeNestApp(d);
    const r = sh("bash", [SCAFFOLD, "products"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(read(d, "src/modules/products/products.repository.ts"), /con Prisma \(inyecta PrismaService\)/);
    assert.ok(!existsSync(join(d, "src/modules/products/products.model.ts")), "a Mongo model was created");
    assert.doesNotMatch(read(d, "src/modules/products/products.module.ts"), /Mongoose/);
    assert.match(read(d, "docs/specs/products_contract.md"), /Modelo Prisma/);
  });
});

describe("make migration and make migrate on NestJS (mongo-support S4)", () => {
  it("with MongoDB, make migration explains there are no migrations and exits 0 whatever NAME is, without docker", () => {
    const d = nestProject("mongo");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    for (const args of [[], ["NAME=create_orders"], ["NAME=Bad Name"]]) {
      const r = sh("make", ["migration", ...args], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, MIGRATION_MSG, args.join(" "));
      assert.match(r.stdout, /make migrate los sincroniza/, args.join(" "));
      assert.doesNotMatch(r.stdout, /Uso: make migration/, args.join(" "));
    }
    assert.equal(fake.calls(), "", "docker was called");
  });

  it("with PostgreSQL, make migration still checks NAME and runs prisma migrate dev in the app container", () => {
    const d = nestProject("postgres");
    assert.equal(sh("make", ["env"], d).code, 0);
    const fake = fakeBin(["docker"]);
    const bad = sh("make", ["migration", "NAME=x"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(bad.code, 2, bad.stdout);
    assert.match(bad.stdout, /Uso: make migration NAME=snake_case/);
    assert.equal(fake.calls(), "");
    const ok = sh("make", ["migration", "NAME=create_orders"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(fake.calls(), /^docker compose .* run --rm -e NAME app sh -c npx --no-install prisma migrate dev/m);
    assert.doesNotMatch(ok.stdout, MIGRATION_MSG);
  });

  // The migrate service's command, as Compose passes it to `sh -c` ($$ is Compose's escape for $).
  const compose = readFileSync(join(REPO, "plantillas/stacks/nestjs/files/compose.yaml"), "utf8");
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

  it("make migrate with Mongoose: compiles in dev, then runs the index sync built into dist", () => {
    assert.ok(migrateScript, "no migrate command in compose.yaml");
    const dev = migrate(["src/mongo/sync-indexes.ts"], { NODE_ENV: "development" });
    assert.equal(dev.code, 0, dev.stdout + dev.stderr);
    assert.equal(dev.calls, "npx --no-install tsc -p tsconfig.build.json\nnode dist/mongo/sync-indexes.js\n");
  });

  it("make migrate with Mongoose in prod (target build, already compiled): only the index sync", () => {
    const prod = migrate(["src/mongo/sync-indexes.ts"], { NODE_ENV: "production" });
    assert.equal(prod.code, 0, prod.stdout + prod.stderr);
    assert.equal(prod.calls, "node dist/mongo/sync-indexes.js\n");
  });

  it("make migrate keeps prisma migrate deploy with a Prisma schema, and nothing to do without a database", () => {
    const prisma = migrate(["prisma/schema.prisma"]);
    assert.equal(prisma.code, 0, prisma.stdout + prisma.stderr);
    assert.equal(prisma.calls, "npx --no-install prisma migrate deploy\n");
    const none = migrate([]);
    assert.equal(none.code, 0);
    assert.equal(none.calls, "");
    assert.match(none.stdout, /nada que migrar/);
  });
});
