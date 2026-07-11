import { defineWorkspace } from "vitest/config";

const workspace = defineWorkspace([
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
      include: ["apps/native-host/src/**/*.test.ts"],
      name: "native-host",
      root: ".",
    },
  },
  {
    test: {
      environment: "jsdom",
      include: ["apps/extension/src/**/*.test.ts"],
      name: "extension",
      root: ".",
    },
  },
]);

export default workspace;
