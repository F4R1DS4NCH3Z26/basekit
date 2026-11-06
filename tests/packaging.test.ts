import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, REPO, scratch, sh } from "./helpers.js";

after(cleanup);

/**
 * The package exactly as `npm install [-g] github:…` gets it: a git repository with the working tree's
 * files (no node_modules, no compiled tests), installed through a `git+file://` URL, which takes the same
 * path in npm as a GitHub URL. CI also installs the real `github:` URL.
 */
let gitUrl = "";
before(() => {
  const repo = scratch();
  cpSync(REPO, repo, {
    recursive: true,
    filter: (src) => !/^(node_modules|dist\/tests|\.git|\.atl)(\/|$)/.test(relative(REPO, src)),
  });
  for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "pkg"]]) {
    const r = sh("git", args, repo);
    assert.equal(r.code, 0, r.stderr);
  }
  gitUrl = `git+file://${repo}`;
});

const PKG = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { name: string; scripts?: Record<string, string> };

describe("Windows", () => {
  it("a clone with core.autocrlf=true (Git for Windows' default) still gets LF templates", () => {
    const clone = join(scratch(), "clone");
    const r = sh("git", ["-c", "core.autocrlf=true", "clone", "-q", gitUrl.replace(/^git\+/, ""), clone], REPO);
    assert.equal(r.code, 0, r.stderr);
    const files = sh("git", ["ls-files", "plantillas"], clone).stdout.split("\n").filter(Boolean);
    assert.ok(files.length > 100);
    const crlf = files.filter((f) => readFileSync(join(clone, f), "utf8").includes("\r"));
    assert.deepEqual(crlf, [], "these templates would break in WSL/Docker with CRLF line endings");
  });
});

describe("package.json", () => {
  it("has none of the scripts that make npm prepare a git dependency", () => {
    // pacote (npm) runs `npm install` inside the clone when any of these exist. That inner install inherits
    // the outer --global, so a global install from GitHub breaks (ENOTDIR, or a link to a deleted clone).
    // Keep the build under another name ("compile") and commit dist/src.
    for (const name of ["build", "install", "preinstall", "postinstall", "prepack", "prepare"]) {
      assert.ok(!(name in (PKG.scripts ?? {})), `scripts.${name} breaks git installs`);
    }
  });
});

/** A global install with its own prefix: npm and npx use it as their global directory. */
function globalInstall(): NodeJS.ProcessEnv {
  const prefix = scratch();
  const env = { PATH: `${join(prefix, "bin")}:${process.env.PATH}`, npm_config_prefix: prefix };
  const r = sh("npm", ["install", "-g", "--no-audit", "--no-fund", gitUrl], prefix, env);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  return env;
}

describe("installation from git", () => {
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
