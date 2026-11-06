import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, REPO, scratch, sh } from "./helpers.js";

after(cleanup);

/**
 * The package as a user gets it: a copy of the repository without dist/ or node_modules/ (what a git
 * install or a fresh clone sees), `npm install` (which runs `prepare`), then `npm pack`.
 */
let tarball = "";
before(() => {
  const copy = scratch();
  cpSync(REPO, copy, {
    recursive: true,
    filter: (src) => !/^(dist|node_modules|\.git|\.atl)(\/|$)/.test(relative(REPO, src)),
  });
  const install = sh("npm", ["install", "--no-audit", "--no-fund"], copy);
  assert.equal(install.code, 0, install.stdout + install.stderr);
  const out = scratch();
  const pack = sh("npm", ["pack", "--pack-destination", out], copy);
  assert.equal(pack.code, 0, pack.stdout + pack.stderr);
  tarball = join(out, readdirSync(out).find((f) => f.endsWith(".tgz"))!);
});

const PKG = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { name: string };

describe("installation", () => {
  it("global: `npm install -g` puts a working `basekit` on the PATH, templates included", () => {
    const prefix = scratch();
    const r = sh("npm", ["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", tarball], prefix);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    // A real global install: npm (and npx) use this prefix as their global directory.
    const env = { PATH: `${join(prefix, "bin")}:${process.env.PATH}`, npm_config_prefix: prefix };
    const stacks = sh("basekit", ["stacks"], prefix, env);
    assert.equal(stacks.code, 0, stacks.stdout + stacks.stderr);
    assert.match(stacks.stdout, /nextjs/);

    const app = join(scratch(), "app");
    const init = sh("basekit", ["init", app, "-y", "--no-external-skills", "--stack", "nextjs"], prefix, env);
    assert.equal(init.code, 0, init.stdout + init.stderr);
    assert.ok(existsSync(join(app, "AGENTS.md")) && existsSync(join(app, "Makefile")));

    // What AGENTS.md tells agents to run must find this install and never download anything.
    const sync = sh("npx", ["--no-install", "basekit", "sync", "--no-external-skills"], app, env);
    assert.equal(sync.code, 0, sync.stdout + sync.stderr);
  });

  it("per project: `npm install -D` and `npx --no-install basekit` inside the project", () => {
    const app = scratch();
    writeFileSync(join(app, "package.json"), '{ "name": "mi-app", "private": true }\n');
    const r = sh("npm", ["install", "-D", "--no-audit", "--no-fund", tarball], app);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).devDependencies[PKG.name]);
    const init = sh("npx", ["--no-install", "basekit", "init", ".", "-y", "--no-external-skills", "--stack", "nextjs"], app);
    assert.equal(init.code, 0, init.stdout + init.stderr);
    assert.ok(existsSync(join(app, "AGENTS.md")));
    const sync = sh("npx", ["--no-install", "basekit", "sync", "--no-external-skills"], app);
    assert.equal(sync.code, 0, sync.stdout + sync.stderr);
  });
});

describe("generated instructions never run a package from the registry", () => {
  it("AGENTS.md, adapters and the kit README only say `npx --no-install basekit` or `basekit`", () => {
    const app = scratch();
    const prefix = scratch();
    assert.equal(sh("npm", ["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", tarball], prefix).code, 0);
    // A real global install: npm (and npx) use this prefix as their global directory.
    const env = { PATH: `${join(prefix, "bin")}:${process.env.PATH}`, npm_config_prefix: prefix };
    assert.equal(sh("basekit", ["init", app, "-y", "--no-external-skills", "--stack", "fastapi", "--agents", "claude-code,opencode"], prefix, env).code, 0);
    for (const f of ["AGENTS.md", ".agents/README.md", ".claude/agents/data-writer.md", ".opencode/agents/data-writer.md", ".make/stack.mk"]) {
      const text = readFileSync(join(app, f), "utf8");
      assert.doesNotMatch(text, /npx basekit/, `${f} tells to run "npx basekit", which can download another package`);
    }
  });
});
