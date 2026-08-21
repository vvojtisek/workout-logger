import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["app/static/styles.css", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  js.configs.recommended,
  {
    files: ["app/static/**/*.js", "frontend/**/*.js", "e2e/**/*.js", "playwright.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
  },
];
