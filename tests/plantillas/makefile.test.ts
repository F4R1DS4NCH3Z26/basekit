import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, hasDocker, scratch, sh } from "../helpers.js";

after(cleanup);

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) => basekit(["init", dir, "--yes", "--no-external-skills", ...extra]);

/** A directory with fake executables that log their calls to `calls.log`. */
function fakeBin(names: Record<string, string>): { path: string; calls: () => string } {
  const bin = scratch(); // removed by cleanup()
  for (const [name, body] of Object.entries(names)) {
    writeFileSync(join(bin, name), `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${bin}/calls.log"\n${body}\n`, { mode: 0o755 });
  }
  return { path: bin, calls: () => (existsSync(join(bin, "calls.log")) ? readFileSync(join(bin, "calls.log"), "utf8") : "") };
}

describe("make new-app when the app already exists", () => {
  const markers: Record<string, string[]> = {
    nextjs: ["package.json"],
    fastapi: ["uv.lock"], // pyproject.toml comes from the starter
    laravel: ["composer.json"],
    spring: ["pom.xml"],
  };
  for (const [stack, files] of Object.entries(markers)) {
    it(`${stack}: does nothing and never calls docker`, () => {
      const d = scratch();
      assert.equal(init(d, "--stack", stack).code, 0);
      for (const f of files) writeFileSync(join(d, f), "{}\n");
      const before = sh("git", ["status", "--porcelain"], d).stdout;
      const fake = fakeBin({ docker: "exit 0" });
      const r = sh("make", ["new-app"], d, { PATH: `${fake.path}:${process.env.PATH}` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /nada que hacer/);
      assert.equal(fake.calls(), "", "docker was called");
      assert.equal(sh("git", ["status", "--porcelain"], d).stdout, before, "new-app changed files");
    });
  }
});

describe("make env merges new variables", () => {
  it("appends only the missing keys with fresh secrets and keeps everything else", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    assert.equal(sh("make", ["env"], d).code, 0);
    writeFileSync(join(d, ".env"), `${read(d, ".env")}MINE=keep\n`);
    const before = read(d, ".env");
    const secret = /^BETTER_AUTH_SECRET=(.+)$/m.exec(before)?.[1];
    assert.ok(secret);

    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", "postgres"], d);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
    assert.match(infra.stdout, /make env/);
    const r = sh("make", ["env"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const after = read(d, ".env");
    assert.ok(after.startsWith(before), "existing content must stay as it was");
    assert.match(after, /^DB_PASSWORD=[0-9a-f]{64}$/m);
    assert.doesNotMatch(after, /^[A-Z_]+=.*__GENERATE/m);
    assert.equal(/^BETTER_AUTH_SECRET=(.+)$/m.exec(after)?.[1], secret);
    assert.equal(statSync(join(d, ".env")).mode & 0o777, 0o600);
    assert.match(r.stdout, /agregad/);

    const again = sh("make", ["env"], d);
    assert.equal(again.code, 0);
    assert.equal(read(d, ".env"), after);
    assert.match(again.stdout, /al día/);
  });

  it("fails without leaving a partial file when openssl fails", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    const fake = fakeBin({ openssl: "exit 1" });
    const r = sh("make", ["env"], d, { PATH: `${fake.path}:${process.env.PATH}` });
    assert.notEqual(r.code, 0);
    assert.ok(!existsSync(join(d, ".env")), ".env must not be created");
    assert.equal(sh("ls", ["-A"], d).stdout.split("\n").filter((f) => f.startsWith(".env.")).join(","), ".env.example");
  });
});

describe("make db-shell with GNU make 4 (Linux)", { skip: hasDocker() ? false : "Docker no disponible" }, () => {
  /** Runs `make db-shell` inside Alpine with a fake docker, where .SHELLFLAGS (-euo pipefail) applies. */
  const linuxMake = (dir: string) =>
    sh("docker", ["run", "--rm", "-v", `${dir}:/p`, "-w", "/p", "alpine:3.22", "sh", "-c",
      "apk add --no-cache make bash >/dev/null && printf '#!/bin/sh\\necho DOCKER \"$@\"\\n' > /usr/local/bin/docker && " +
      "chmod +x /usr/local/bin/docker && make db-shell"], dir);

  it("opens the database console", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi", "--db", "postgres").code, 0);
    writeFileSync(join(d, ".env"), "X=1\n");
    const r = linuxMake(d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /DOCKER compose .* exec db sh -c psql -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"/);
  });

  it("explains when there is no database", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi").code, 0);
    writeFileSync(join(d, ".env"), "X=1\n");
    const r = linuxMake(d);
    assert.notEqual(r.code, 0);
    assert.match(r.stdout + r.stderr, /No hay base de datos configurada/);
  });
});

describe("make new-app resolves dependencies at least 14 days old", () => {
  it("nextjs: every npm/npx in _new-app runs with npm_config_before = now - 14 days", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    const dry = sh("make", ["-n", "_new-app"], d);
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /export npm_config_before="\$\(node -p "new Date\(Date\.now\(\) - 14 \* 864e5\)\.toISOString\(\)"\)"/);
    assert.ok(dry.stdout.indexOf("npm_config_before") < dry.stdout.indexOf("create-next-app"), "must be set before any npx/npm call");
  });
});

describe("make new-app authenticates composer downloads", () => {
  it("laravel: forwards COMPOSER_AUTH by name, never its value on the command line", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "laravel").code, 0);
    const fake = fakeBin({ docker: "exit 0" });
    const secret = '{"github-oauth":{"github.com":"tok-123"}}';
    const r = sh("make", ["_new-app"], d, { PATH: `${fake.path}:${process.env.PATH}`, COMPOSER_AUTH: secret });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(fake.calls(), /^docker run .*-e COMPOSER_AUTH .*composer:2 /m);
    assert.ok(!(fake.calls() + r.stdout + r.stderr).includes("tok-123"), "the token must not reach argv or the log");
  });
});

describe("fixes shared with the Go implementation", () => {
  it("make env keeps the last value of an env file that has no final newline", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    assert.equal(sh("make", ["env"], d).code, 0);
    writeFileSync(join(d, ".env"), read(d, ".env").replace(/\n$/, "") + "\nLAST=kept");
    sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", "postgres"], d);
    const r = sh("make", ["env"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(read(d, ".env"), /^LAST=kept$/m);
    assert.match(read(d, ".env"), /^DB_PASSWORD=[0-9a-f]{64}$/m);
  });

  it("spring: SPRING_DB follows compose.db.yaml and is none without a database", () => {
    // `make -n` prints the recipe with SPRING_DB expanded (macOS make 3.81 has no --eval).
    const value = (dir: string) => /case "([a-z]*)" in/.exec(sh("make", ["-n", "_new-app"], dir).stdout)?.[1];
    const none = scratch();
    assert.equal(init(none, "--stack", "spring").code, 0);
    assert.equal(value(none), "none");
    const pg = scratch();
    assert.equal(init(pg, "--stack", "spring", "--db", "postgres").code, 0);
    assert.equal(value(pg), "postgresql");
    const my = scratch();
    assert.equal(init(my, "--stack", "spring", "--db", "mysql").code, 0);
    assert.equal(value(my), "mysql");
  });

  it("nextjs: new-app stops when the copy produced no package.json", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    assert.match(sh("make", ["-n", "_new-app"], d).stdout, /cp -R --update=none \/tmp\/app\/\. \/work\/ && test -f \/work\/package\.json && cd \/work/);
  });
});
