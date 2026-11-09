// Router mínimo sobre node:http (zona del orquestador): método + ruta con parámetros (`/products/:id`), middlewares
// encadenados (`use`) y routers de módulo montados con prefijo (`mount`). createHandler() lo convierte en el
// listener del servidor: cabeceras de seguridad, CORS, cuerpo JSON (100 KB), 404/405 y errores → JSON.
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { HttpError, readJsonBody, sendError, sendJson, setSecurityHeaders } from "./http.js";

export type Context = {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  /** Parámetros de la ruta (`/products/:id` → `{ id }`), ya decodificados. Valídalos con Zod. */
  readonly params: Record<string, string>;
  /** Query string; si una clave se repite, gana la última. Valídala con Zod. */
  readonly query: Record<string, string>;
  /** Cuerpo JSON ya parseado; `undefined` si la petición no trae cuerpo. Valídalo con Zod. */
  readonly body: unknown;
  /** Datos entre middlewares de la misma petición (p. ej. el usuario autenticado). */
  readonly locals: Record<string, unknown>;
  /** Responde JSON con ese código. */
  json(status: number, body: unknown): void;
  /** Responde sin cuerpo (204 por defecto). */
  empty(status?: number): void;
};

export type Next = () => Promise<void>;
/** Un middleware llama a `next()` para seguir; un handler final responde y no lo llama. */
export type Handler = (ctx: Context, next: Next) => void | Promise<void>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Route = { method: Method; segments: string[]; handlers: Handler[] };
type Mount = { segments: string[]; router: Router };
type Found = { handlers: Handler[]; params: Record<string, string> };

const split = (path: string): string[] => path.split("/").filter(Boolean);

/** Compara segmentos (`:x` captura uno). `prefix`: basta con que la ruta empiece así; devuelve el resto. */
function matchSegments(
  pattern: string[],
  parts: string[],
  prefix: boolean,
): { params: Record<string, string>; rest: string[] } | undefined {
  if (prefix ? parts.length < pattern.length : parts.length !== pattern.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, seg] of pattern.entries()) {
    const part = parts[i] as string;
    if (seg.startsWith(":")) params[seg.slice(1)] = part;
    else if (seg !== part) return undefined;
  }
  return { params, rest: parts.slice(pattern.length) };
}

export class Router {
  private readonly middlewares: Handler[] = [];
  private readonly routes: Route[] = [];
  private readonly mounts: Mount[] = [];

  /** Middleware para todas las rutas de este router (y de los que monte). */
  use(...handlers: Handler[]): this {
    this.middlewares.push(...handlers);
    return this;
  }

  get(path: string, ...handlers: Handler[]): this {
    return this.add("GET", path, handlers);
  }
  post(path: string, ...handlers: Handler[]): this {
    return this.add("POST", path, handlers);
  }
  put(path: string, ...handlers: Handler[]): this {
    return this.add("PUT", path, handlers);
  }
  patch(path: string, ...handlers: Handler[]): this {
    return this.add("PATCH", path, handlers);
  }
  delete(path: string, ...handlers: Handler[]): this {
    return this.add("DELETE", path, handlers);
  }

  /** Monta el router de un módulo bajo un prefijo: `router.mount("/products", productsRouter)`. */
  mount(prefix: string, router: Router): this {
    this.mounts.push({ segments: split(prefix), router });
    return this;
  }

  private add(method: Method, path: string, handlers: Handler[]): this {
    if (handlers.length === 0) throw new Error(`Ruta sin handler: ${method} ${path}`);
    this.routes.push({ method, segments: split(path), handlers });
    return this;
  }

  /** Busca la ruta. Sin coincidencia: `allow` dice qué métodos existen para esa ruta (405) o está vacío (404). */
  find(method: string, parts: string[], inherited: Handler[] = []): { found?: Found; allow: Set<string> } {
    const chain = [...inherited, ...this.middlewares];
    const allow = new Set<string>();
    for (const route of this.routes) {
      const m = matchSegments(route.segments, parts, false);
      if (!m) continue;
      if (route.method === method || (method === "HEAD" && route.method === "GET")) {
        return { found: { handlers: [...chain, ...route.handlers], params: m.params }, allow };
      }
      allow.add(route.method);
    }
    for (const mount of this.mounts) {
      const m = matchSegments(mount.segments, parts, true);
      if (!m) continue;
      const sub = mount.router.find(method, m.rest, chain);
      if (sub.found) return { found: { handlers: sub.found.handlers, params: { ...m.params, ...sub.found.params } }, allow };
      for (const a of sub.allow) allow.add(a);
    }
    return { allow };
  }
}

/** Ejecuta la cadena: cada middleware decide si sigue con `next()`. */
async function run(handlers: Handler[], ctx: Context): Promise<void> {
  let last = -1;
  const step = async (i: number): Promise<void> => {
    if (i <= last) throw new Error("next() llamado dos veces");
    last = i;
    const handler = handlers[i];
    if (handler) await handler(ctx, () => step(i + 1));
  };
  await step(0);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "Ruta mal codificada");
  }
}

export type HandlerOptions = {
  /** Orígenes con acceso CORS (CORS_ORIGINS). Vacío: ningún origen externo. */
  corsOrigins?: readonly string[];
};

const CORS_METHODS = "GET, POST, PUT, PATCH, DELETE";
const CORS_HEADERS = "Authorization, Content-Type";

/**
 * CORS a mano: solo un origen de la lista recibe Access-Control-Allow-Origin, y su preflight (OPTIONS con
 * Access-Control-Request-Method) se responde aquí con 204. Devuelve true si ya respondió.
 */
function applyCors(allowed: ReadonlySet<string>, req: IncomingMessage, res: ServerResponse, method: string): boolean {
  // La respuesta cambia según Origin: una caché nunca debe servir la de un origen a otro.
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (origin === undefined || !allowed.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (method !== "OPTIONS" || req.headers["access-control-request-method"] === undefined) return false;
  res.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
  res.setHeader("Access-Control-Allow-Headers", CORS_HEADERS);
  res.setHeader("Access-Control-Max-Age", "600");
  res.statusCode = 204;
  res.end();
  return true;
}

async function handle(
  router: Router,
  cors: ReadonlySet<string>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  setSecurityHeaders(res);
  try {
    const url = req.url ?? "/";
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);
    const query = Object.fromEntries(new URLSearchParams(q === -1 ? "" : url.slice(q + 1)));
    const method = (req.method ?? "GET").toUpperCase();
    if (applyCors(cors, req, res, method)) return;
    const parts = split(path).map(decodeSegment);
    // Como express.json(): el cuerpo se lee antes de enrutar (límite, 413, 415 y 400 valen para cualquier ruta).
    const body = await readJsonBody(req);

    const { found, allow } = router.find(method, parts);
    if (!found) {
      if (allow.size > 0) {
        res.setHeader("Allow", [...allow].join(", "));
        throw new HttpError(405, "Método no permitido");
      }
      throw new HttpError(404, "No encontrado");
    }
    const ctx: Context = {
      req,
      res,
      method,
      path,
      params: found.params,
      query,
      body,
      locals: {},
      json: (status, data) => sendJson(res, status, data),
      empty: (status = 204) => {
        res.statusCode = status;
        res.end();
      },
    };
    await run(found.handlers, ctx);
    if (!res.writableEnded) throw new Error(`Ningún handler respondió a ${method} ${path}`);
  } catch (err) {
    sendError(res, err);
  }
}

/** Listener para `createServer()`. Nunca rechaza: todo error termina en sendError (JSON). */
export function createHandler(router: Router, { corsOrigins = [] }: HandlerOptions = {}): RequestListener {
  const cors = new Set(corsOrigins);
  return (req, res) => {
    void handle(router, cors, req, res);
  };
}
