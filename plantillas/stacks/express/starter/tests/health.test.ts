import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("responde 200 con status ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("responde 404 en JSON para una ruta desconocida", async () => {
    const res = await request(createApp()).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No encontrado" });
  });

  it("responde 400 sin detalles con JSON mal formado", async () => {
    const res = await request(createApp()).post("/health").set("Content-Type", "application/json").send("{");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Solicitud inválida" });
  });
});
