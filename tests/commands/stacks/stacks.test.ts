import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStacks } from "../../../src/kit/stacks.js";
import { basekit, cleanup, scratch } from "../../helpers.js";

after(cleanup);

const manifest = (dir: string) => JSON.parse(readFileSync(join(dir, ".agents/manifest.json"), "utf8"));

describe("stacks command", () => {
  it("lists every stack read from plantillas/stacks and the supported agents", () => {
    const r = basekit(["stacks"]);
    assert.equal(r.code, 0, r.stderr);
    for (const s of loadStacks()) assert.ok(r.stdout.includes(`${s.name} (puerto ${s.port})`), s.id);
    for (const id of ["claude-code", "opencode", "codex", "cursor", "gemini-cli", "github-copilot", "hermes-agent"]) {
      assert.match(r.stdout, new RegExp(`\\b${id}\\b`));
    }
  });
});

describe("stack detection", () => {
  it("detects a stack from detect.files", () => {
    const d = scratch();
    writeFileSync(join(d, "next.config.ts"), "export default {};\n");
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(manifest(d).stack, "nextjs");
  });

  it("detects a stack from detect.manifest + detect.contains", () => {
    const d = scratch();
    writeFileSync(join(d, "pyproject.toml"), '[project]\ndependencies = ["fastapi>=0.115"]\n');
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(manifest(d).stack, "fastapi");
  });

  it("fails clearly when the stack cannot be detected and nothing can be asked", () => {
    const d = scratch();
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /--stack/);
    assert.deepEqual(readdirSync(d), []);
  });
});

/** Runs `init --yes` on a folder holding `files` (path -> content); returns the result and the stack written. */
function detect(files: Record<string, string>): { code: number; stderr: string; stack?: string } {
  const d = scratch();
  for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
  const r = basekit(["init", d, "--yes", "--no-external-skills"]);
  return { code: r.code, stderr: r.stderr, stack: r.code === 0 ? manifest(d).stack : undefined };
}

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "app", dependencies: deps });

describe("stack detection with every stack (S7)", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["nest-cli.json wins over the Express inside NestJS", { "nest-cli.json": "{}\n", "package.json": pkg({ "@nestjs/core": "11", "@nestjs/platform-express": "11", express: "5" }) }, "nestjs"],
    ["a Next.js project that also uses Express and React stays nextjs", { "next.config.ts": "export default {};\n", "package.json": pkg({ next: "16", react: "19", express: "5" }) }, "nextjs"],
    ["a Vite React project is react", { "vite.config.ts": "", "package.json": JSON.stringify({ dependencies: { react: "19" }, devDependencies: { "@vitejs/plugin-react": "5", vite: "7" } }) }, "react"],
    ["a Vite Vue project is vue", { "vite.config.ts": "", "package.json": JSON.stringify({ dependencies: { vue: "3" }, devDependencies: { "@vitejs/plugin-vue": "6", vite: "7" } }) }, "vue"],
    ["manage.py is django, never django-htmx", { "manage.py": "", "pyproject.toml": '[project]\ndependencies = ["django", "django-htmx"]\n' }, "django"],
    ["a FastAPI pyproject is fastapi", { "pyproject.toml": '[project]\ndependencies = ["fastapi>=0.115"]\n' }, "fastapi"],
    ["a Flask pyproject is flask", { "pyproject.toml": '[project]\ndependencies = ["flask>=3"]\n' }, "flask"],
    ["artisan is laravel", { artisan: "", "composer.json": '{"require":{"laravel/framework":"^12"}}\n' }, "laravel"],
    ["symfony.lock is symfony", { "symfony.lock": "{}\n", "composer.json": '{"require":{"symfony/framework-bundle":"7.*"}}\n' }, "symfony"],
    ["a Gin go.mod is gin", { "go.mod": "module app\n\ngo 1.27\n\nrequire github.com/gin-gonic/gin v1.11.0\n" }, "gin"],
    ["a Spring Boot pom.xml is spring", { "pom.xml": "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>\n" }, "spring"],
  ];
  for (const [title, files, expected] of cases) {
    it(title, () => {
      const r = detect(files);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stack, expected);
    });
  }

  const undetected: [string, Record<string, string>][] = [
    ["a package.json with express is never express", { "package.json": pkg({ express: "5" }) }],
    ["a package.json with only react (no @vitejs/plugin-react) is not react", { "package.json": pkg({ react: "19" }) }],
    ["a plain go.mod is not go-native", { "go.mod": "module app\n\ngo 1.27\n" }],
    ["a plain pyproject is not python-native", { "pyproject.toml": '[project]\nname = "app"\n' }],
    ["a plain composer.json is not php-native", { "composer.json": '{"require":{"php":">=8.5"}}\n' }],
    ["a vite.config.ts alone is not vanilla-ts", { "vite.config.ts": "", "package.json": JSON.stringify({ devDependencies: { vite: "7", typescript: "5" } }) }],
  ];
  for (const [title, files] of undetected) {
    it(title, () => {
      const r = detect(files);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /No se pudo detectar el stack\. Usa --stack <id>/);
    });
  }

  it("native stacks, express and django-htmx have no detect rule", () => {
    const none = loadStacks().filter((s) => Object.keys(s.detect).length === 0).map((s) => s.id);
    assert.deepEqual(none, ["django-htmx", "express", "go-native", "node-native", "php-native", "python-native", "vanilla-ts"]);
  });
});
