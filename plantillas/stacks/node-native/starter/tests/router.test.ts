import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHandler, Router, type Handler } from "../src/lib/router.js";

const requireToken: Handler = async (ctx, next) => {
  if (ctx.req.headers.authorization !== "Bearer ok") return ctx.json(401, { error: "No autorizado" });
  ctx.locals.user = "u1";
  await next();
};

function app() {
  const items = new Router().use(requireToken);
  items.get("/:id", (ctx) => ctx.json(200, { id: ctx.params.id, user: ctx.locals.user, q: ctx.query }));
  items.post("/", (ctx) => ctx.json(201, { received: ctx.body }));
  items.delete("/:id", (ctx) => ctx.empty());

  const root = new Router();
  root.get("/boom", () => {
    throw new Error("detalle interno");
  });
  root.get("/silent", () => undefined);
  root.mount("/items", items);
  return createHandler(root);
}

describe("Router", () => {
  it("pasa params decodificados, query y locals del middleware", async () => {
    const res = await request(app()).get("/items/a%20b?limit=5").set("Authorization", "Bearer ok");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "a b", user: "u1", q: { limit: "5" } });
  });

  it("el middleware del router montado corta la cadena (401)", async () => {
    const res = await request(app()).get("/items/1");
    expect(res.status).toBe(401);
  });

  it("entrega el cuerpo JSON parseado y responde 204 sin cuerpo", async () => {
    const created = await request(app()).post("/items").set("Authorization", "Bearer ok").send({ name: "A" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ received: { name: "A" } });
    expect((await request(app()).delete("/items/1").set("Authorization", "Bearer ok")).status).toBe(204);
  });

  it("500 sin detalles cuando un handler lanza o no responde", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = await request(app()).get("/boom");
    expect(boom.status).toBe(500);
    expect(boom.body).toEqual({ error: "Error interno" });
    expect((await request(app()).get("/silent")).status).toBe(500);
    spy.mockRestore();
  });

  it("400 con una ruta mal codificada", async () => {
    expect((await request(app()).get("/items/%E0%A4%A")).status).toBe(400);
  });
});
