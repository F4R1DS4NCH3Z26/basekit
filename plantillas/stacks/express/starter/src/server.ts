// Arranque del servidor (zona del orquestador).
import { createApp } from "./app.js";
import { env } from "./lib/env.js";

const server = createApp().listen(env.PORT, "0.0.0.0", () => {
  console.log(`API escuchando en el puerto ${env.PORT}`);
});

// docker stop envía SIGTERM: termina las peticiones en curso antes de salir.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
