import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const configFiles = [
  "eslint.config.mjs",
  "prettier.config.mjs",
  "playwright.config.ts",
  "vitest*.config.ts",
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
      ".agents/skills/**",
      ".worktrees/**",
      "node_modules/**",
      "playwright-report/**",
      "supabase/.temp/**",
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
    files: ["apps/extension/**/*.ts", "apps/store-extension/**/*.ts"],
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
    files: ["apps/store-extension/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              message: "The Store extension cannot depend on the Classic native host.",
              name: "@huayi/native-host",
            },
            {
              message: "The Store extension must use its own domain contracts.",
              name: "@huayi/protocol",
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
              message: "Domain contract packages must stay platform neutral.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/store-domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@huayi/cloud-contracts",
              message: "Store domain cannot depend on Cloud contracts.",
            },
            { name: "@huayi/protocol", message: "Store domain cannot depend on Classic protocol." },
            { name: "@huayi/store-domain", message: "Store domain cannot import itself." },
          ],
          patterns: [
            {
              group: ["node:*", "@huayi/*/*"],
              message: "Domain packages stay platform neutral and use public package exports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/learning-domain/**/*.ts", "packages/cloud-contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@huayi/cloud-contracts",
              message: "Domain packages cannot import Cloud contracts.",
            },
            {
              name: "@huayi/protocol",
              message: "Cloud packages cannot depend on Classic protocol.",
            },
            {
              name: "@huayi/store-domain",
              message: "Cloud packages cannot depend on Store domain.",
            },
          ],
          patterns: [
            {
              group: ["node:*", "@huayi/*/*"],
              message: "Cloud packages stay platform neutral and use public package exports.",
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
