// Respuestas de error comunes (zona del orquestador). Express 5 envía aquí también los errores de handlers async.
import type { NextFunction, Request, Response } from "express";

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: "No encontrado" });
}

/** Los errores 4xx de Express (JSON mal formado, cuerpo demasiado grande) conservan su código; el resto es 500 sin detalles. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "Solicitud inválida" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Error interno" });
}
