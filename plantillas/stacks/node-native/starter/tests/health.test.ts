import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const app = createApp();

describe("GET /health", () => {
  it("responde 200 con status ok y cabeceras de seguridad", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("responde 404 en JSON para una ruta desconocida", async () => {
    const res = await request(app).get("/no-existe");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "No encontrado" });
  });

  it("responde 405 con Allow para un método no registrado", async () => {
    const res = await request(app).delete("/health");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("GET");
  });
});

describe("cuerpo JSON", () => {
  it("400 sin detalles con JSON mal formado", async () => {
    const res = await request(app).post("/health").set("Content-Type", "application/json").send("{");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "JSON mal formado" });
  });

  it("413 con un cuerpo de más de 100 KB", async () => {
    const res = await request(app).post("/health").send({ data: "x".repeat(200 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Cuerpo demasiado grande" });
  });

  it("415 con un cuerpo que no es JSON", async () => {
    const res = await request(app).post("/health").set("Content-Type", "text/plain").send("hola");
    expect(res.status).toBe(415);
  });
});
