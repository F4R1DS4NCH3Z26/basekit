// HTTP sobre node:http (zona del orquestador): respuestas JSON, lectura del cuerpo con límite, cabeceras de
// seguridad y el mapeo de errores a JSON. Sin dependencias: lo usan src/lib/router.ts y los middlewares.
import type { IncomingMessage, ServerResponse } from "node:http";

/** Error con código HTTP. Su mensaje llega al cliente: nunca pongas datos internos en él. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Tamaño máximo del cuerpo JSON (como `express.json({ limit: "100kb" })`). */
export const BODY_LIMIT_BYTES = 100 * 1024;

// Las cabeceras que helmet pone por defecto que tienen sentido en una API JSON. node:http no agrega X-Powered-By.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

export function setSecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

/** Error → JSON. HttpError conserva su código y su mensaje; el resto es 500 sin detalles (el detalle va al log). */
export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    // La respuesta ya empezó: no se puede cambiar el código. Se corta la conexión.
    console.error(err);
    res.destroy();
    return;
  }
  if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
    sendJson(res, err.status, { error: err.message });
    return;
  }
  console.error(err);
  sendJson(res, 500, { error: "Error interno" });
}

function isJson(contentType: string | undefined): boolean {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json" || (type.startsWith("application/") && type.endsWith("+json"));
}

/**
 * Lee y parsea el cuerpo JSON. Sin cuerpo → undefined. Otro Content-Type → 415; más de `limit` bytes → 413;
 * JSON mal formado → 400. Lo que sobra de un cuerpo rechazado se descarta (server.requestTimeout lo acota).
 */
export async function readJsonBody(req: IncomingMessage, limit = BODY_LIMIT_BYTES): Promise<unknown> {
  const declared = req.headers["content-length"];
  const chunked = req.headers["transfer-encoding"] !== undefined;
  if (!chunked && (declared === undefined || Number(declared) === 0)) return undefined;
  if (!isJson(req.headers["content-type"])) throw new HttpError(415, "Content-Type no soportado: usa application/json");
  if (declared !== undefined && Number(declared) > limit) throw new HttpError(413, "Cuerpo demasiado grande");

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: HttpError): void => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      if (error) {
        req.resume(); // descarta el resto sin guardarlo
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) finish(new HttpError(413, "Cuerpo demasiado grande"));
      else chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", () => finish());
    req.once("error", () => finish(new HttpError(400, "Petición incompleta")));
    req.once("close", () => finish(new HttpError(400, "Petición incompleta")));
  });

  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "JSON mal formado");
  }
}
