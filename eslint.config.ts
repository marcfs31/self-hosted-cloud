import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/next-env.d.ts", "**/coverage/**", "graft/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["apps/web/**"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@cloud/shared",
              allowTypeImports: true,
              message: "apps/web imports only types from @cloud/shared.",
            },
          ],
          patterns: [
            {
              group: ["@cloud/api", "@cloud/api/*", "better-sqlite3", "drizzle-orm*", "node:fs*"],
              message: "apps/web never touches the API's storage.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.config.ts", "eslint.config.ts", "scripts/**"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
