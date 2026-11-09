// ESLint for TypeScript without a framework. The DOM rules forbid parsing strings as HTML: build elements with
// `h()` (src/lib/dom.ts), which only creates text nodes.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "coverage", "node_modules"] },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    rules: {
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Usa h() o textContent: innerHTML interpreta HTML (XSS)." },
        { property: "outerHTML", message: "Usa h() o textContent: outerHTML interpreta HTML (XSS)." },
        { property: "insertAdjacentHTML", message: "Usa h(): insertAdjacentHTML interpreta HTML (XSS)." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: "Prohibido document.write." },
      ],
    },
  },
);
