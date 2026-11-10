import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Vitest reuses the Vite config (Vue plugin, so .vue files compile) and adds the DOM environment for components.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["tests/**/*.test.ts"],
      setupFiles: ["tests/setup.ts"],
      restoreMocks: true,
    },
  }),
);
