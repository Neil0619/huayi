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
    },
  };
}

const e2eViteConfig = defineConfig({
  plugins: [buildExtensionFixtures()],
  resolve: {
    alias: {
      "@huayi/protocol": protocolSource,
      "@huayi/store-domain": storeDomainSource,
    },
  },
  root: repositoryRoot,
});

export default e2eViteConfig;
