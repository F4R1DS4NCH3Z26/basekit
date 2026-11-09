// Composición de la app (zona del orquestador): middlewares, /health y routers de cada módulo.
import express from "express";
import helmet from "helmet";
import { cors } from "./lib/cors.js";
import { env } from "./lib/env.js";
import { errorHandler, notFound } from "./lib/http.js";

export type AppOptions = {
  /** Orígenes con acceso CORS. Por defecto, CORS_ORIGINS. */
  corsOrigins?: readonly string[];
};

export function createApp({ corsOrigins = env.CORS_ORIGINS }: AppOptions = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Detrás de un proxy (TLS), activa: app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors(corsOrigins));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Routers de cada módulo (los imprime express-scaffold):
  // app.use("/products", productsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
