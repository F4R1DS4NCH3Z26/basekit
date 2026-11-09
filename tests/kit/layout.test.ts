import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveParts, wireEnv } from "../../src/kit/layout.js";
import { loadStacks } from "../../src/kit/stacks.js";

const STACKS = loadStacks();
const BACKEND = STACKS.find((s) => s.kind === "backend")!;
const FRONTEND = STACKS.find((s) => s.kind === "frontend")!;

describe("wireEnv (S16): each half of a combined project points at the other", () => {
  const parts = resolveParts(STACKS, `${BACKEND.id}+${FRONTEND.id}`);
  const backend = parts[0]!;
  const frontend = parts[1]!;
  const api = `http://127.0.0.1:${BACKEND.port}`;
  const web = `http://127.0.0.1:${FRONTEND.port}`;

  it("sets the backend's CORS_ORIGINS and the frontend's VITE_API_URL when the env file has them", () => {
    assert.deepEqual(wireEnv(parts, backend, "A=1\nCORS_ORIGINS=x\n"), { text: `A=1\nCORS_ORIGINS=${web},http://localhost:${FRONTEND.port}\n` });
    assert.deepEqual(wireEnv(parts, frontend, "VITE_API_URL=x\nB=2\n"), { text: `VITE_API_URL=${api}\nB=2\n` });
  });

  it("leaves the text alone and says what to wire by hand when the variable is missing", () => {
    const back = wireEnv(parts, backend, "A=1\n");
    assert.equal(back.text, "A=1\n");
    assert.match(back.warning ?? "", new RegExp(`^${BACKEND.id} no tiene CORS_ORIGINS: .*${web.replace(/\./g, "\\.")}`));
    const front = wireEnv(parts, frontend, "B=2\n");
    assert.equal(front.text, "B=2\n");
    assert.match(front.warning ?? "", new RegExp(`^${FRONTEND.id} no tiene VITE_API_URL: .*${api.replace(/\./g, "\\.")}`));
  });

  it("does nothing for a single stack", () => {
    const [single] = resolveParts(STACKS, BACKEND.id);
    assert.deepEqual(wireEnv([single!], single!, "A=1\n"), { text: "A=1\n" });
  });
});
