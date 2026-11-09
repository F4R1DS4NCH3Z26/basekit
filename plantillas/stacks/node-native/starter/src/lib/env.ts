// Configuración tipada desde variables de entorno (nunca leas .env a mano). Compose y los overlays las inyectan.
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // compose.db.yaml (src/lib/db.ts las usa según la BD): postgresql://…, mysql://… o file:/app/data/app.db,
  // y DB_* para el adaptador de MySQL. Opcionales: sin BD la app arranca igual.
  DATABASE_URL: z.string().min(1).optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_DATABASE: z.string().optional(),
  // compose.redis.yaml: redis://:<password>@redis:6379/0
  REDIS_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default("app"),
  JWT_AUDIENCE: z.string().min(1).default("app-clients"),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Solo los nombres y los motivos: nunca los valores (pueden ser secretos).
  throw new Error(`Variables de entorno inválidas: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`);
}

export const env = parsed.data;
