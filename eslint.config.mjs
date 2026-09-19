import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import noFixedE2eDate from "./scripts/eslint/no-fixed-e2e-date.mjs";

export default tseslint.config(
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dev-dist/**",
      "**/.prisma/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "packages/backend/src/generated/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.commonjs,
        ...globals.node,
      },
      sourceType: "commonjs",
    },
  },
  {
    files: ["packages/frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: reactHooks.configs.flat["recommended-latest"].plugins,
    rules: reactHooks.configs.flat["recommended-latest"].rules,
  },
  {
    files: ["e2e/**/*.{ts,mjs}"],
    plugins: { sui: { rules: { "no-fixed-e2e-date": noFixedE2eDate } } },
    rules: { "sui/no-fixed-e2e-date": "error" },
  },
  {
    files: ["e2e/**/*.spec.ts", "e2e/**/*.setup.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@playwright/test", importNames: ["test"], message: "時計を揃える helpers/test の test を使ってください。" }],
      }],
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
  },
);
