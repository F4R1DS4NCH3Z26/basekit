import { defineConfig } from "vitest/config";

// No vite.config.ts in this stack (Vite runs with its defaults); Vitest only adds the DOM environment.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
