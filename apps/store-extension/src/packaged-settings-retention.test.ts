// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it, vi } from "vitest";

import { createStoreExtensionConfig } from "../vite.config.js";
import { createPackagedWorkerStorage, loadPackagedWorker } from "./packaged-worker.test-support.js";
import { createChromeStoreAppearance } from "./service-worker/store-appearance.js";
import { createChromeStoreSettings } from "./service-worker/store-settings.js";
import { createExtensionSessionVault } from "./service-worker/extension-session-vault.js";
import { createBrowserDeviceVault } from "./vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "./vault/chrome-vault-storage.js";

it("restarting the packaged hosted worker preserves settings, encrypted credentials and pairing without session storage", async () => {
  const storage = createPackagedWorkerStorage();
  const settings = createChromeStoreSettings(storage.local);
  await settings.setProvider("deepseek");
  await settings.grantNetworkConsent(new Date("2026-09-04"));
  await settings.grantRecipientConsent("eudic", new Date("2026-09-04"));
  await settings.setRecipientEnabled("eudic", true);
  await settings.setDefaultAction("explain");
  await settings.setOverlayTheme("parchment");
  await settings.setYoutubeMode("bilingual");
  await settings.upsertSiteRule({
    hostname: "ersoft.cn",
    includeSubdomains: true,
    action: "block",
  });
  await settings.setSiteEnabled("wiki.ersoft.cn", true);
  await createChromeStoreAppearance(storage.local).set("porcelain");
  const expectedSettings = await settings.get();
  const adapter = createChromeVaultStorageAdapter(storage);
  const vault = createBrowserDeviceVault({ crypto: globalThis.crypto, storage: adapter });
  const credentials = [
    ["openai-api-key", "fictional-openai-key"],
    ["deepseek-api-key", "fictional-deepseek-key"],
    ["eudic-authorization", "fictional-eudic-token"],
  ] as const;
  for (const [slot, secret] of credentials) await vault.setCredential(slot, secret);
  const dek = await vault.getDek();
  const sessionVault = createExtensionSessionVault({
    crypto: globalThis.crypto,
    deviceVault: vault,
    storage: {
      read: adapter.readPersistent,
      write: adapter.writePersistent,
      delete: adapter.deletePersistent,
    },
  });
  const installId = await sessionVault.getOrCreateInstallId();
  const session = {
    expiresAt: "2099-01-01T00:00:00.000Z",
    preferences: {
      cloudWordCopyMode: "enabled" as const,
      extensionQueryModelMode: "byok" as const,
      revision: 5,
      studyCaptureMode: "manual" as const,
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    token: "fictional-session-token".repeat(3),
  };
  await sessionVault.writeSession(session);
  const directory = await mkdtemp(join(tmpdir(), "huayi-settings-retention-"));
  try {
    const config = createStoreExtensionConfig("background", "hosted-acceptance");
    await build({ ...config, configFile: false, build: { ...config.build, outDir: directory } });
    const source = await readFile(join(directory, "service-worker.js"), "utf8");
    for (let restart = 0; restart < 3; restart++) {
      const restartedStorage = {
        local: storage.local,
        session: createPackagedWorkerStorage().session,
      };
      const worker = loadPackagedWorker(
        source,
        "hoijjhgcckfhbcefoclgbhkgninnkknd",
        restartedStorage,
      );
      await expect(worker.send("store/popup-status")).resolves.toMatchObject({
        providerId: "deepseek",
        appearance: "porcelain",
      });
      await expect(worker.send("store/cloud-session-status")).resolves.toMatchObject({
        status: "connected",
      });
      await expect(createChromeStoreSettings(storage.local).get()).resolves.toEqual(
        expectedSettings,
      );
      const restartedVault = createBrowserDeviceVault({
        crypto: globalThis.crypto,
        storage: createChromeVaultStorageAdapter(restartedStorage),
      });
      await expect(restartedVault.getDek()).resolves.toEqual(dek);
      for (const [slot, secret] of credentials)
        await expect(restartedVault.getCredential(slot)).resolves.toBe(secret);
      await expect(sessionVault.getOrCreateInstallId()).resolves.toBe(installId);
      await expect(sessionVault.readSession()).resolves.toEqual(session);
      // Opening the account controls now checks revocation. The offline fixture
      // keeps the stored session, without starting or replacing a pairing.
      expect(worker.requests).toEqual([
        { method: undefined, url: "https://api.acceptance.seen-said.cn/v1/extension-preferences" },
      ]);
    }
    const revokedWorker = loadPackagedWorker(source, "hoijjhgcckfhbcefoclgbhkgninnkknd", storage, {
      preferencesResponse: () =>
        Response.json(
          { error: { code: "authentication_required", message: "Revoked", requestId: "r-1" } },
          { status: 401 },
        ),
    });
    await expect(revokedWorker.send("store/cloud-session-status")).resolves.toMatchObject({
      status: "connected",
    });
    await vi.waitFor(async () =>
      expect(await revokedWorker.send("store/cloud-session-status")).toMatchObject({
        status: "disconnected",
      }),
    );
    await expect(sessionVault.readSession()).resolves.toBeNull();
    await expect(createChromeStoreSettings(storage.local).get()).resolves.toEqual(expectedSettings);
    for (const [slot, secret] of credentials)
      await expect(vault.getCredential(slot)).resolves.toBe(secret);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
