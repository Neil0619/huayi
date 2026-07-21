import { defineWorkspace } from "vitest/config";
import { fileURLToPath } from "node:url";

const protocolSource = fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url));
const protocolAlias = { "@huayi/protocol": protocolSource };

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
]);

export default workspace;
