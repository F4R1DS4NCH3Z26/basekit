// Composición de la app (zona del orquestador): /health y los routers de cada módulo, sobre node:http sin framework.
import type { RequestListener } from "node:http";
import { env } from "./lib/env.js";
import { createHandler, Router } from "./lib/router.js";

export type AppOptions = {
  /** Orígenes con acceso CORS. Por defecto, CORS_ORIGINS. */
  corsOrigins?: readonly string[];
};

export function createApp({ corsOrigins = env.CORS_ORIGINS }: AppOptions = {}): RequestListener {
  const router = new Router();

  router.get("/health", (ctx) => {
    ctx.json(200, { status: "ok" });
  });

  // Routers de cada módulo (los imprime nodenative-scaffold):
  // router.mount("/products", productsRouter);

  return createHandler(router, { corsOrigins });
}
