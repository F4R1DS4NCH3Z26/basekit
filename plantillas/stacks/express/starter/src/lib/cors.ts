// CORS (zona del orquestador): solo los orígenes de CORS_ORIGINS reciben Access-Control-Allow-Origin y su preflight.
// Sin la variable (o vacía), ningún origen externo: el navegador bloquea las llamadas desde otro origen.
import type { RequestHandler } from "express";

const METHODS = "GET, POST, PUT, PATCH, DELETE";
const HEADERS = "Authorization, Content-Type";

/** `CORS_ORIGINS=http://localhost:5173,https://app.example.com` → lista sin espacios ni entradas vacías. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((o) => o.trim()).filter(Boolean);
}

export function cors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    // La respuesta cambia según Origin: una caché nunca debe servir la de un origen a otro.
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin === undefined || !allowed.has(origin)) {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS" && req.headers["access-control-request-method"] !== undefined) {
      res.setHeader("Access-Control-Allow-Methods", METHODS);
      res.setHeader("Access-Control-Allow-Headers", HEADERS);
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  };
}
