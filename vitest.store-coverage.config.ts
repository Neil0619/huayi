import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const cloudContractsSource = fileURLToPath(
  new URL("./packages/cloud-contracts/src/index.ts", import.meta.url),
);
const learningDomainSource = fileURLToPath(
  new URL("./packages/learning-domain/src/index.ts", import.meta.url),
);
const storeDomainSource = fileURLToPath(
  new URL("./packages/store-domain/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@huayi/cloud-contracts": cloudContractsSource,
      "@huayi/learning-domain": learningDomainSource,
      "@huayi/store-domain": storeDomainSource,
    },
  },
  test: {
    // V8 coverage plus concurrent real Vite builds can starve Windows workers.
    // Bound resource use without changing test deadlines or coverage thresholds.
    maxWorkers: 4,
    coverage: {
      all: true,
      enabled: true,
      exclude: ["**/*.test.ts"],
      include: [
        "apps/store-extension/src/analysis/browser-analysis-engine.ts",
        "apps/store-extension/src/analysis/provider-events.ts",
        "apps/store-extension/src/lexicon/browser-lexicon-repository.ts",
        "apps/store-extension/src/lexicon/lexicon-crypto.ts",
        "apps/store-extension/src/service-worker/analysis-session.ts",
        "apps/store-extension/src/service-worker/store-settings.ts",
        "apps/store-extension/src/vault/browser-device-vault.ts",
        "apps/store-extension/src/wordbook/browser-wordbook-export-engine.ts",
        "apps/store-extension/src/wordbook/encrypted-wordbook-state-store.ts",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/store-extension",
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    environment: "jsdom",
    include: ["apps/store-extension/src/**/*.test.ts"],
  },
});
