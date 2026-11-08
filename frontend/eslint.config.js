// Flat ESLint config for the frontend package. Deliberately small: the
// typescript-eslint "recommended" rules only, with formatting rules left to
// Prettier (eslint-config-prettier switches off the ones that would clash).
import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Vite's config file runs in Node, not the browser.
    files: ["vite.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Underscore-prefixed unused args are intentional (e.g. Express error
    // handlers that must keep all four parameters).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
