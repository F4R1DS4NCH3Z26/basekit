import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadStacks } from "../src/kit/stacks.js";
import { SRC_DIR } from "./helpers.js";

/** Every .ts file under src/, as paths relative to src/. */
function sources(dir = SRC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith(".ts") ? [relative(SRC_DIR, join(dir, e.name))] : [],
  );
}

/** Relative imports of a source file, resolved to paths relative to src/ (".js" → ".ts"). */
function imports(file: string): string[] {
  const text = readFileSync(join(SRC_DIR, file), "utf8");
  return [...text.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map((m) =>
    relative(SRC_DIR, resolve(SRC_DIR, dirname(file), m[1]!)).replace(/\.js$/, ".ts"),
  );
}

const layer = (file: string) => file.split("/")[0]!.replace(/\.ts$/, "");
const commandOf = (file: string) => (file.startsWith("commands/") && file.split("/").length > 2 ? file.split("/")[1] : undefined);

/** Which layers each layer may import (cli → commands → kit → infra; ui sits next to commands). */
const MAY_IMPORT: Record<string, string[]> = {
  cli: ["commands", "infra", "kit", "ui"],
  commands: ["commands", "infra", "kit", "ui"],
  ui: ["kit"],
  kit: ["kit", "infra"],
  infra: [],
};

describe("architecture", () => {
  it("every source file lives in a known layer", () => {
    for (const f of sources()) assert.ok(layer(f) in MAY_IMPORT, `${f} is outside cli/commands/kit/infra/ui`);
  });

  it("dependencies only point inwards: cli → commands → kit → infra", () => {
    for (const f of sources()) {
      for (const target of imports(f)) {
        assert.ok(MAY_IMPORT[layer(f)]!.includes(layer(target)), `${f} imports ${target}`);
      }
    }
  });

  it("only node: built-ins outside ui/; ui/ may also import @clack/prompts, the one runtime dependency (ADR 0002)", () => {
    for (const f of sources()) {
      const text = readFileSync(join(SRC_DIR, f), "utf8");
      const specifiers = [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^\s*import\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]!);
      for (const pkg of specifiers) {
        if (pkg.startsWith(".") || pkg.startsWith("node:")) continue;
        assert.ok(layer(f) === "ui" && pkg === "@clack/prompts", `${f} imports the package "${pkg}"`);
      }
    }
  });

  it("a command never reaches into another command; outside commands/ only its index.ts is public", () => {
    for (const f of sources()) {
      for (const target of imports(f)) {
        const into = commandOf(target);
        if (!into) continue;
        const from = commandOf(f);
        if (from === into) continue;
        assert.ok(from === undefined, `command ${from} imports command ${into} (${f} → ${target})`);
        assert.ok(target.endsWith("/index.ts"), `${f} imports ${target} instead of commands/${into}/index.ts`);
      }
    }
  });

  it("has no stack id hardcoded in src/ (stacks are data in plantillas/)", () => {
    for (const f of sources()) {
      const text = readFileSync(join(SRC_DIR, f), "utf8");
      for (const { id } of loadStacks()) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `${f} mentions "${id}"`);
    }
  });
});
