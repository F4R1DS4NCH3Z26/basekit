// ESLint (flat config). Las reglas no-restricted-imports hacen cumplir las capas de cada módulo.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const noHttp = "La lógica no conoce HTTP: devuelve datos o lanza errores de errors.ts.";

export default tseslint.config(
  // src/generated/: cliente de Prisma (lo crea `prisma generate`).
  { ignores: ["dist/", "coverage/", "node_modules/", "src/generated/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Lógica y schemas sin HTTP ni ORM: se prueban sin servidor y sin BD.
    files: ["src/modules/*/services.ts", "src/modules/*/errors.ts", "src/modules/*/schemas.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "node:http", message: noHttp },
          { name: "http", message: noHttp },
        ],
        patterns: [
          { group: ["**/lib/router", "**/lib/router.js", "**/lib/http", "**/lib/http.js"], message: noHttp },
          // El cliente de Prisma 7 vive en src/generated/prisma (y sus paquetes en @prisma/*).
          { group: ["@prisma/*", "**/generated/**", "**/lib/db", "**/lib/db.js"], message: "Accede a datos solo a través de repository.ts." },
        ],
      }],
    },
  },
  {
    // El router solo habla con services.ts.
    files: ["src/modules/*/router.ts", "src/modules/*/middleware.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/repository", "**/repository.js", "**/lib/db", "**/lib/db.js"], message: "El router llama a services.ts, nunca al repositorio." },
          { group: ["@prisma/*", "**/generated/**"], message: "El router llama a services.ts, nunca al ORM." },
        ],
      }],
    },
  },
);
