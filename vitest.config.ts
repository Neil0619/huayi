import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const protocolSource = fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url));
const storeDomainSource = fileURLToPath(
  new URL("./packages/store-domain/src/index.ts", import.meta.url),
);
const learningDomainSource = fileURLToPath(
  new URL("./packages/learning-domain/src/index.ts", import.meta.url),
);
const cloudContractsSource = fileURLToPath(
  new URL("./packages/cloud-contracts/src/index.ts", import.meta.url),
);

const protocolAlias = { "@huayi/protocol": protocolSource };
const storeDomainAlias = { "@huayi/store-domain": storeDomainSource };
const cloudAlias = {
  "@huayi/cloud-contracts": cloudContractsSource,
  "@huayi/learning-domain": learningDomainSource,
};
const learningDomainAlias = { "@huayi/learning-domain": learningDomainSource };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          environment: "node",
          include: ["packages/protocol/src/**/*.test.ts"],
          name: "protocol",
          root: ".",
        },
      },
      {
        test: {
          environment: "node",
          include: ["packages/learning-domain/src/**/*.test.ts"],
          name: "learning-domain",
          root: ".",
        },
      },
      {
        resolve: {
          alias: cloudAlias,
        },
        test: {
          environment: "node",
          include: ["packages/cloud-contracts/src/**/*.test.ts"],
          name: "cloud-contracts",
          root: ".",
        },
      },
      {
        resolve: {
          alias: learningDomainAlias,
        },
        test: {
          environment: "node",
          include: ["packages/store-domain/src/**/*.test.ts"],
          name: "store-domain",
          root: ".",
        },
      },
      {
        resolve: {
          alias: protocolAlias,
        },
        test: {
          environment: "node",
          include: ["apps/native-host/src/**/*.test.ts"],
          name: "native-host",
          root: ".",
        },
      },
      {
        resolve: {
          alias: protocolAlias,
        },
        test: {
          environment: "jsdom",
          include: ["apps/extension/src/**/*.test.ts"],
          name: "extension",
          root: ".",
        },
      },
      {
        resolve: {
          alias: { ...cloudAlias, ...storeDomainAlias },
        },
        test: {
          environment: "jsdom",
          include: ["apps/store-extension/src/**/*.test.ts"],
          name: "store-extension",
          root: ".",
        },
      },
      {
        resolve: {
          alias: cloudAlias,
        },
        test: {
          environment: "node",
          include: ["apps/api/src/**/*.test.ts"],
          name: "api",
          root: ".",
        },
      },
      {
        resolve: {
          alias: cloudAlias,
        },
        test: {
          environment: "jsdom",
          include: ["apps/web/src/**/*.test.ts", "apps/web/src/**/*.test.tsx"],
          name: "web",
          root: ".",
        },
      },
    ],
  },
});
