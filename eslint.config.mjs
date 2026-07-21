import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const configFiles = [
  "eslint.config.mjs",
  "prettier.config.mjs",
  "playwright.config.ts",
  "vitest.workspace.ts",
  "**/vite.config.ts",
];

export const filenamePlugin = {
  rules: {
    "kebab-case": {
      create(context) {
        return {
          Program(node) {
            const filename = context.filename.replaceAll("\\", "/").split("/").at(-1) ?? "";
            const stem = filename.replace(/\.(?:mjs|ts)$/, "");
            const isKebabCase = stem
              .split(".")
              .every((part) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part));

            if (!isKebabCase) {
              context.report({
                node,
                message: "Use a kebab-case filename.",
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      ".worktrees/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts"],
    plugins: {
      filenames: filenamePlugin,
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-check": false,
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          format: ["camelCase", "UPPER_CASE"],
          selector: "variable",
        },
        {
          format: ["camelCase"],
          selector: "function",
        },
        {
          format: ["PascalCase"],
          selector: "typeLike",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "filenames/kebab-case": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@huayi/*/*"],
              message: "Import workspace packages through their public entrypoint.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          message: "Use named exports instead of a default export.",
          selector: "ExportDefaultDeclaration",
        },
      ],
    },
  },
  {
    files: configFiles,
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["apps/extension/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              message: "The extension cannot depend on the native host package.",
              name: "@huayi/native-host",
            },
          ],
          patterns: [
            {
              group: ["@huayi/*/*"],
              message: "Import workspace packages through their public entrypoint.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/native-host/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              message: "The native host cannot depend on the extension package.",
              name: "@huayi/extension",
            },
          ],
          patterns: [
            {
              group: ["@huayi/*/*"],
              message: "Import workspace packages through their public entrypoint.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/protocol/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "@huayi/*", "@huayi/*/*"],
              message: "The protocol package must stay platform neutral.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/src/**/*.ts"],
    rules: {
      "max-lines": [
        "error",
        {
          max: 400,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
);
