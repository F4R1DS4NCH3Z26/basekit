// ESLint for Vue SFCs and TypeScript (flat config). create-vite only offers ESLint for React, so basekit adds it.
import { globalIgnores } from "eslint/config";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";

export default defineConfigWithVueTs(
  { name: "app/files-to-lint", files: ["**/*.{ts,mts,tsx,vue}"] },
  globalIgnores(["**/dist/**", "**/coverage/**", "**/node_modules/**"]),
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
);
