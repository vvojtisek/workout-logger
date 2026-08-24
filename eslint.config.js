import js from "@eslint/js";
import globals from "globals";

// TypeScript sources are intentionally excluded: typescript-eslint does not yet
// support the TypeScript 7 compiler API this repository pins, so `tsc --noEmit`
// under `strict`, `noUnusedLocals`, and `noUnusedParameters` is the gate for
// `frontend/src`. Revisit once typescript-eslint ships TS >= 7.1 support.
export default [
  {
    ignores: [
      "app/static/dist/**",
      "frontend/**/*.ts",
      "frontend/**/*.tsx",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["e2e/**/*.js", "playwright.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["app/static/sw.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },
];
