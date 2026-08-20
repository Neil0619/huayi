import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build, defineConfig, type Plugin } from "vite";

import { createExtensionConfig } from "../vite.config.js";
import { createStoreExtensionConfig } from "../../store-extension/vite.config.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const protocolSource = fileURLToPath(
  new URL("../../../packages/protocol/src/index.ts", import.meta.url),
);
const storeDomainSource = fileURLToPath(
  new URL("../../../packages/store-domain/src/index.ts", import.meta.url),
);
const learningDomainSource = fileURLToPath(
  new URL("../../../packages/learning-domain/src/index.ts", import.meta.url),
);
const cloudContractsSource = fileURLToPath(
  new URL("../../../packages/cloud-contracts/src/index.ts", import.meta.url),
);
const cloudApiOrigin = "https://api.huayi.invalid";
const webRoot = resolve(repositoryRoot, "apps/web");
const webConfig = resolve(repositoryRoot, "apps/web/vite.config.ts");

function buildExtensionFixtures(): Plugin {
  return {
    name: "build-extension-fixtures",
    async configureServer() {
      await build(createExtensionConfig("content"));
      await build(createExtensionConfig("youtube-bridge"));
      await build(createExtensionConfig("options"));
      await build(createExtensionConfig("popup"));
      await build(createExtensionConfig("background"));
      for (const mode of [
        "content",
        "youtube-content",
        "youtube-main",
        "options",
        "popup",
        "background",
      ]) {
        await build(createStoreExtensionConfig(mode));
      }
      const previousApiOrigin = process.env.VITE_API_ORIGIN;
      process.env.VITE_API_ORIGIN = cloudApiOrigin;
      try {
        await build({
          configFile: webConfig,
          resolve: {
            alias: {
              "@huayi/cloud-contracts": cloudContractsSource,
              "@huayi/learning-domain": learningDomainSource,
            },
          },
          root: webRoot,
        });
      } finally {
        if (previousApiOrigin === undefined) delete process.env.VITE_API_ORIGIN;
        else process.env.VITE_API_ORIGIN = previousApiOrigin;
      }
    },
  };
}

const e2eViteConfig = defineConfig({
  plugins: [buildExtensionFixtures()],
  resolve: {
    alias: {
      "@huayi/protocol": protocolSource,
      "@huayi/store-domain": storeDomainSource,
      "@huayi/cloud-contracts": cloudContractsSource,
      "@huayi/learning-domain": learningDomainSource,
    },
  },
  root: repositoryRoot,
});

export default e2eViteConfig;
