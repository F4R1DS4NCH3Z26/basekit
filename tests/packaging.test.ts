import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, REPO, scratch, sh } from "./helpers.js";

after(cleanup);

/**
 * The package as a git install gets it: only what the repository holds (no node_modules, no compiled
 * tests, no build step, no devDependencies), packed with `npm pack`. A global `npm install -g github:…`
 * cannot rely on a build at install time (npm prepares git dependencies with the outer --global
 * and skips their devDependencies), so this must already be installable. CI also installs the real
 * `github:` URL.
 */
let gitUrl = "";
before(() => {
  const repo = scratch();
  cpSync(REPO, repo, {
    recursive: true,
    filter: (src) => !/^(node_modules|dist\/tests|\.git|\.atl)(\/|$)/.test(relative(REPO, src)),
  });
  const out = scratch();
  const pack = sh("npm", ["pack", "--pack-destination", out], repo);
  assert.equal(pack.code, 0, pack.stdout + pack.stderr);
  const name = pack.stdout.trim().split("\n").at(-1)!;
  gitUrl = join(out, name);
  assert.ok(existsSync(gitUrl), `no tarball: ${pack.stdout}`);
});

const PKG = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { name: string };

/** A global install with its own prefix: npm and npx use it as their global directory. */
function globalInstall(): NodeJS.ProcessEnv {
  const prefix = scratch();
  const env = { PATH: `${join(prefix, "bin")}:${process.env.PATH}`, npm_config_prefix: prefix };
  const r = sh("npm", ["install", "-g", "--no-audit", "--no-fund", gitUrl], prefix, env);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return env;
}

describe("installation from the repository contents", () => {
  it("global: `npm install -g` puts a working `basekit` on the PATH, templates included", () => {
    const env = globalInstall();
    const stacks = sh("basekit", ["stacks"], REPO, env);
    assert.equal(stacks.code, 0, stacks.stdout + stacks.stderr);
    assert.match(stacks.stdout, /nextjs/);

    const app = join(scratch(), "app");
    const init = sh("basekit", ["init", app, "-y", "--no-external-skills", "--stack", "nextjs"], REPO, env);
    assert.equal(init.code, 0, init.stdout + init.stderr);
    assert.ok(existsSync(join(app, "AGENTS.md")) && existsSync(join(app, "Makefile")));

    // What AGENTS.md tells agents to run must find this install and never download anything.
    const sync = sh("npx", ["--no-install", "basekit", "sync", "--no-external-skills"], app, env);
    assert.equal(sync.code, 0, sync.stdout + sync.stderr);
  });

  it("per project: `npm install -D` and `npx --no-install basekit` inside the project", () => {
    const app = scratch();
    writeFileSync(join(app, "package.json"), '{ "name": "mi-app", "private": true }\n');
    const r = sh("npm", ["install", "-D", "--no-audit", "--no-fund", gitUrl], app);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).devDependencies[PKG.name]);
    const init = sh("npx", ["--no-install", "basekit", "init", ".", "-y", "--no-external-skills", "--stack", "nextjs"], app);
    assert.equal(init.code, 0, init.stdout + init.stderr);
    assert.ok(existsSync(join(app, "AGENTS.md")));
    const sync = sh("npx", ["--no-install", "basekit", "sync", "--no-external-skills"], app);
    assert.equal(sync.code, 0, sync.stdout + sync.stderr);
  });
});

describe("basekit install, with a real npm", () => {
  /** The CLI straight from this checkout, as `npx github:…/basekit` would run it. */
  const cli = join(REPO, "dist/src/cli.js");

  it("--global installs a working basekit", () => {
    const prefix = scratch();
    const env = { PATH: `${join(prefix, "bin")}:${process.env.PATH}`, npm_config_prefix: prefix };
    const r = sh(process.execPath, [cli, "install", "--global", "--from", gitUrl], prefix, env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(sh("basekit", ["stacks"], prefix, env).stdout, /nextjs/);
  });

  it("--project adds the devDependency and npx --no-install finds it", () => {
    const app = scratch();
    writeFileSync(join(app, "package.json"), '{ "name": "mi-app", "private": true }\n');
    const r = sh(process.execPath, [cli, "install", app, "--project", "--from", gitUrl], app);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).devDependencies[PKG.name]);
    assert.match(sh("npx", ["--no-install", "basekit", "stacks"], app).stdout, /nextjs/);
  });
});

describe("generated instructions never run a package from the registry", () => {
  it("AGENTS.md, adapters, the kit README and stack.mk only say `npx --no-install basekit`", () => {
    const env = globalInstall();
    const app = join(scratch(), "app");
    assert.equal(sh("basekit", ["init", app, "-y", "--no-external-skills", "--stack", "fastapi", "--agents", "claude-code,opencode"], REPO, env).code, 0);
    for (const f of ["AGENTS.md", ".agents/README.md", ".claude/agents/data-writer.md", ".opencode/agents/data-writer.md", ".make/stack.mk"]) {
      const text = readFileSync(join(app, f), "utf8");
      assert.doesNotMatch(text, /npx basekit/, `${f} tells to run "npx basekit", which can download another package`);
    }
  });
});
