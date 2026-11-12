import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dbEngines, KINDS, loadStacks } from "../../src/kit/stacks.js";
import { cleanup, REPO, scratch } from "../helpers.js";

after(cleanup);

/** S1b: the kind of every stack, as the user classified them. */
const EXPECTED_KIND: Record<string, string> = {
  fastapi: "backend", django: "backend", flask: "backend", "python-native": "backend",
  nestjs: "backend", express: "backend", "node-native": "backend",
  symfony: "backend", "php-native": "backend", spring: "backend", gin: "backend", "go-native": "backend",
  react: "frontend", vue: "frontend", "vanilla-ts": "frontend",
  nextjs: "fullstack", laravel: "fullstack", "django-htmx": "fullstack",
};

/** A stacks folder with one stack `x` whose stack.json is the real fastapi one plus `patch`. */
function stacksDir(patch: Record<string, unknown>): string {
  const base = JSON.parse(readFileSync(join(REPO, "plantillas/stacks/fastapi/stack.json"), "utf8"));
  const dir = scratch();
  mkdirSync(join(dir, "x"));
  writeFileSync(join(dir, "x", "stack.json"), JSON.stringify({ ...base, id: "x", ...patch }));
  return dir;
}

describe("stack.json", () => {
  it("every stack declares its kind, language and health, and its name starts with the language", () => {
    const stacks = loadStacks();
    assert.deepEqual(stacks.map((s) => s.id).sort(), Object.keys(EXPECTED_KIND).sort());
    for (const s of stacks) {
      assert.equal(s.kind, EXPECTED_KIND[s.id], s.id);
      assert.ok(KINDS.includes(s.kind), s.id);
      assert.ok(s.language.length > 0, s.id);
      assert.match(s.health, /^\//, s.id);
      assert.ok(s.name.startsWith(`${s.language} · `), `${s.id}: "${s.name}"`);
    }
  });

  it("keeps the id order, which is also the detection order", () => {
    const ids = loadStacks().map((s) => s.id);
    assert.deepEqual(ids, [...ids].sort());
  });

  it("accepts a valid stack.json from another folder", () => {
    assert.deepEqual(loadStacks(stacksDir({})).map((s) => s.id), ["x"]);
  });

  it("rejects a kind outside backend, frontend and fullstack", () => {
    for (const kind of ["mobile", "", undefined]) {
      assert.throws(() => loadStacks(stacksDir({ kind })), /stack\.json inválido: stacks\/x\/stack\.json/, String(kind));
    }
  });

  it("accepts an optional dbs list of known engines and rejects anything else (S6)", () => {
    assert.deepEqual(loadStacks(stacksDir({ dbs: ["mysql", "mongo"] }))[0]!.dbs, ["mysql", "mongo"]);
    for (const dbs of [[], ["oracle"], ["auto"], ["none"], "postgres", [3]]) {
      assert.throws(() => loadStacks(stacksDir({ dbs })), /stack\.json inválido/, JSON.stringify(dbs));
    }
  });

  it("dbEngines: the stack's dbs, or the four engines when it has none (S6)", () => {
    const spring = loadStacks().find((s) => s.id === "spring")!;
    assert.deepEqual(dbEngines(spring), ["postgres", "mysql", "mongo"]);
    assert.deepEqual(dbEngines(loadStacks().find((s) => s.id === "flask")!), ["postgres", "mysql", "sqlite", "mongo"]);
  });

  it("rejects an empty or missing language and a missing health", () => {
    for (const patch of [{ language: "" }, { language: undefined }, { language: 3 }, { health: undefined }]) {
      assert.throws(() => loadStacks(stacksDir(patch)), /stack\.json inválido/, JSON.stringify(patch));
    }
  });
});
