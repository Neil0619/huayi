import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const protocolSource = fileURLToPath(
  new URL("../../../packages/protocol/src/index.ts", import.meta.url),
);

const e2eViteConfig = defineConfig({
  resolve: {
    alias: {
      "@huayi/protocol": protocolSource,
    },
  },
  root: repositoryRoot,
});

export default e2eViteConfig;
