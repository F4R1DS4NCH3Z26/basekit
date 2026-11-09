// Composición de la app (zona del orquestador): /health y los routers de cada módulo, sobre node:http sin framework.
import type { RequestListener } from "node:http";
import { createHandler, Router } from "./lib/router.js";

export function createApp(): RequestListener {
  const router = new Router();

  router.get("/health", (ctx) => {
    ctx.json(200, { status: "ok" });
  });

  // Routers de cada módulo (los imprime nodenative-scaffold):
  // router.mount("/products", productsRouter);

  return createHandler(router);
}
