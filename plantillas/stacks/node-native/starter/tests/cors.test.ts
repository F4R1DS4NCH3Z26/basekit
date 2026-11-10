import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const allowed = "http://localhost:5173";
const app = createApp({ corsOrigins: [allowed] });

describe("CORS", () => {
  it("responde el preflight de un origen permitido con 204 y sus cabeceras", async () => {
    const res = await request(app)
      .options("/health")
      .set("Origin", allowed)
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(allowed);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("agrega Access-Control-Allow-Origin a las respuestas de un origen permitido", async () => {
    const res = await request(app).get("/health").set("Origin", allowed);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(allowed);
  });

  it("no da acceso a un origen que no está en la lista", async () => {
    const preflight = await request(app)
      .options("/health")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(preflight.status).toBe(405);
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    const res = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sin orígenes configurados no da acceso a nadie", async () => {
    const res = await request(createApp({ corsOrigins: [] })).get("/health").set("Origin", allowed);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
