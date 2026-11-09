// Arranque del servidor (zona del orquestador): node:http, timeouts acotados y cierre ordenado.
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./lib/env.js";

const server = createServer(
  // requestTimeout acota cuánto puede tardar un cliente en enviar la petición (cuerpos lentos o enormes).
  { requestTimeout: 30_000, headersTimeout: 15_000 },
  createApp(),
);
server.keepAliveTimeout = 5_000;

server.listen(env.PORT, "0.0.0.0", () => {
  console.log(`API escuchando en el puerto ${env.PORT}`);
});

// docker stop envía SIGTERM: deja de aceptar conexiones, termina las peticiones en curso y sale con 0.
// Si alguna sigue abierta a los 10 s, se cierra a la fuerza (docker manda SIGKILL a los 10 s).
let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 8_000).unref();
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, shutdown);
