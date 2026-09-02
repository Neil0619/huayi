// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "vite";
import { describe, expect, it } from "vitest";

import acceptanceManifest from "../manifest.hosted-acceptance.json" with { type: "json" };
import releaseManifest from "../manifest.json" with { type: "json" };
import { createStoreExtensionConfig } from "../vite.config.js";

const apiOrigin = "https://api.acceptance.seen-said.cn";
const webWorkspaceUrl = "https://app.acceptance.seen-said.cn/app";
const extensionId = "hoijjhgcckfhbcefoclgbhkgninnkknd";

function extensionIdFromKey(key: string): string {
  const alphabet = "abcdefghijklmnop";
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].flatMap((byte) => [alphabet[byte >> 4], alphabet[byte & 15]]).join("");
}

describe("Hosted acceptance Store profile", () => {
  it("extends only the release manifest with one public key and the exact acceptance API", () => {
    expect(extensionIdFromKey(acceptanceManifest.key)).toBe(extensionId);
    expect(acceptanceManifest).toEqual({
      ...releaseManifest,
      content_security_policy: {
        extension_pages: `${releaseManifest.content_security_policy.extension_pages} ${apiOrigin}`,
      },
      host_permissions: [...releaseManifest.host_permissions, `${apiOrigin}/*`],
      key: acceptanceManifest.key,
    });
    expect(acceptanceManifest.key).toMatch(/^MIIBI[A-Za-z0-9+/]+={0,2}$/u);
  });

  it("builds fixed acceptance origins and the acceptance-only manifest into one package", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "huayi-store-hosted-acceptance-"));
    try {
      const config = createStoreExtensionConfig("background", "hosted-acceptance");
      await build({
        ...config,
        build: { ...config.build, emptyOutDir: true, outDir: outputDirectory },
        configFile: false,
      });
      const packagedManifest = JSON.parse(
        await readFile(join(outputDirectory, "manifest.json"), "utf8"),
      );
      const serviceWorker = await readFile(join(outputDirectory, "service-worker.js"), "utf8");

      expect(packagedManifest).toEqual(acceptanceManifest);
      expect(serviceWorker).toContain(apiOrigin);
      expect(serviceWorker).toContain(webWorkspaceUrl);
      expect(serviceWorker).not.toContain("HUAYI_CLOUD_API_ORIGIN_BUILD_VALUE");
      expect(serviceWorker).not.toContain("HUAYI_WEB_WORKSPACE_URL_BUILD_VALUE");
    } finally {
      await rm(outputDirectory, { force: true, recursive: true });
    }
  });

  it("rejects every unknown build profile instead of accepting endpoint input", () => {
    expect(() => createStoreExtensionConfig("background", "production")).toThrow(
      /Store Extension build profile is invalid/u,
    );
  });
});
