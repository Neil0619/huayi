// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it, vi } from "vitest";
import { backfillStatus, createBackfillState, discoverBackfill } from "@huayi/store-domain";
import { shanbayBackfillCommandSchema } from "@huayi/cloud-contracts";
import { createStoreExtensionConfig } from "../vite.config.js";
import { createPackagedWorkerStorage, loadPackagedWorker } from "./packaged-worker.test-support.js";
import { createChromeStoreSettings } from "./service-worker/store-settings.js";
import { createExtensionSessionVault } from "./service-worker/extension-session-vault.js";
import { createBrowserDeviceVault } from "./vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "./vault/chrome-vault-storage.js";
import { backfillViewSchema, type BackfillView } from "./backfill/backfill-messages.js";

it("the actual hosted bundle discovers empty-context Eudic words, retains status on failure, and opens its existing queue", async () => {
  const storage = createPackagedWorkerStorage();
  const settings = createChromeStoreSettings(storage.local);
  await settings.grantNetworkConsent(new Date());
  await settings.grantRecipientConsent("eudic", new Date());
  await settings.setRecipientEnabled("eudic", true);
  const adapter = createChromeVaultStorageAdapter(storage);
  const device = createBrowserDeviceVault({ crypto: globalThis.crypto, storage: adapter });
  await device.setCredential("eudic-authorization", "NIS fictional-eudic-token");
  const session = createExtensionSessionVault({
    crypto: globalThis.crypto,
    deviceVault: device,
    storage: {
      read: adapter.readPersistent,
      write: adapter.writePersistent,
      delete: adapter.deletePersistent,
    },
  });
  await session.writeSession({
    token: "fictional-session-token".repeat(3),
    expiresAt: "2099-01-01T00:00:00.000Z",
    preferences: {
      cloudWordCopyMode: "disabled",
      extensionQueryModelMode: "platform",
      studyCaptureMode: "manual",
      revision: 1,
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
  });
  const ledger = createBackfillState();
  let enabled = false,
    revision = 0,
    eudicStatus = 200;
  const scopeId = "account-a";
  const now = () => new Date().toISOString();
  const status = () => ({
    ...backfillStatus(ledger),
    enabled,
    dailyHour: 8,
    revision,
    scopeId,
    lastCheckedAt: null,
  });
  const eudicRequests: string[] = [];
  let blockedPage: Promise<void> | null = null;
  const request = async (url: URL, init?: RequestInit) => {
    if (url.origin === "https://api.frdic.com") {
      expect(url.pathname).toBe("/api/open/v1/studylist/words");
      expect(init?.method).toBe("GET");
      eudicRequests.push(url.searchParams.get("page") ?? "missing");
      if (blockedPage) await blockedPage;
      return Response.json(
        {
          data: [
            {
              word: "apple",
              exp: "",
              phon: "",
              star: 1,
              add_time: "2026-09-15T00:00:00.000Z",
              context_line: "",
            },
          ],
          message: "",
        },
        { status: eudicStatus },
      );
    }
    expect(url.origin).toBe("https://api.acceptance.seen-said.cn");
    if (url.pathname.endsWith("/status")) return Response.json(status());
    if (url.pathname.endsWith("/unresolved"))
      return Response.json({ items: [], unknownBatches: [], revision, nextCursor: null });
    expect(url.pathname).toBe("/v1/shanbay-backfill");
    const command = shanbayBackfillCommandSchema.parse(JSON.parse(String(init?.body)));
    if (command.action === "settings") enabled = command.enabled;
    if (command.action === "discover")
      discoverBackfill(ledger, command.headwords, command.origin, now());
    revision += 1;
    return Response.json({ status: status(), accepted: true, batch: null, nextCursor: null });
  };
  const directory = await mkdtemp(join(tmpdir(), "huayi-packaged-backfill-"));
  try {
    const config = createStoreExtensionConfig("background", "hosted-acceptance");
    await build({ ...config, configFile: false, build: { ...config.build, outDir: directory } });
    const source = await readFile(join(directory, "service-worker.js"), "utf8");
    const worker = loadPackagedWorker(source, "hoijjhgcckfhbcefoclgbhkgninnkknd", storage, {
      request,
    });
    const settled = async (runtime: typeof worker, assert: (view: BackfillView) => void) => {
      await vi.waitFor(
        async () => {
          const snapshot = backfillViewSchema.parse(
            await runtime.sendMessage({ type: "store/backfill-status" }),
          );
          expect(snapshot.initializing).toBe(false);
          expect(snapshot.checking).toBe(false);
          assert(snapshot);
        },
        { timeout: 3_000 },
      );
    };
    await settled(worker, (snapshot) => expect(snapshot.status.enabled).toBe(false));
    await expect(
      worker.sendMessage({
        type: "store/backfill-enable",
        expectedScope: scopeId,
        enabled: true,
        shareLocal: true,
      }),
    ).resolves.toMatchObject({
      status: { enabled: true },
    });
    await settled(worker, (snapshot) =>
      expect(snapshot).toMatchObject({ status: { pendingCount: 1 }, checkError: null }),
    );
    await expect(
      worker.sendMessage({ type: "store/backfill-check", expectedScope: scopeId }),
    ).resolves.toMatchObject({ status: { pendingCount: 1 }, checkError: null });
    await settled(worker, (snapshot) => expect(snapshot.checkError).toBeNull());
    expect(eudicRequests).toEqual(["0", "0"]);
    eudicStatus = 401;
    await expect(
      worker.sendMessage({ type: "store/backfill-check", expectedScope: scopeId }),
    ).resolves.toMatchObject({ status: { pendingCount: 1 } });
    await settled(worker, (snapshot) => expect(snapshot.checkError).toContain("欧路"));
    await expect(
      worker.sendMessage({ type: "store/backfill-open", expectedScope: scopeId }),
    ).resolves.toMatchObject({
      status: { pendingCount: 1 },
      checkError: expect.stringContaining("欧路"),
    });
    expect(worker.openedUrls).toContain("https://web.shanbay.com/wordsweb/#/collection");
    expect(worker.badges.at(-1)).toBe("1");
    expect(worker.requests.some((r) => r.url.startsWith("https://web.shanbay.com"))).toBe(false);
    // A large existing queue must stay usable while the next Eudic page is suspended.
    const history = Array.from(
      { length: 495 },
      (_, index) =>
        `history-${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    discoverBackfill(ledger, history, "eudic", now());
    let releasePage: () => void = () => undefined;
    blockedPage = new Promise<void>((resolve) => {
      releasePage = resolve;
    });
    const requestsBefore = eudicRequests.length;
    await worker.sendMessage({ type: "store/backfill-check", expectedScope: scopeId });
    await vi.waitFor(() => expect(eudicRequests.length).toBeGreaterThan(requestsBefore));
    try {
      const started = performance.now();
      for (let index = 0; index < 10; index += 1)
        await expect(worker.sendMessage({ type: "store/backfill-status" })).resolves.toMatchObject({
          status: { pendingCount: 496 },
        });
      expect(performance.now() - started).toBeLessThan(1_000);
      expect(eudicRequests).toHaveLength(requestsBefore + 1);
      await expect(
        worker.sendMessage({ type: "store/backfill-open", expectedScope: scopeId }),
      ).resolves.toMatchObject({ status: { pendingCount: 496 } });
      expect(worker.openedUrls.at(-1)).toBe("https://web.shanbay.com/wordsweb/#/collection");
      expect(eudicRequests).toHaveLength(requestsBefore + 1);
    } finally {
      eudicStatus = 200;
      releasePage();
      blockedPage = null;
    }
    await settled(worker, (snapshot) => expect(snapshot.checkError).toBeNull());
    let releaseBadge: () => void = () => undefined;
    const blockedBadge = new Promise<void>((resolve) => {
      releaseBadge = resolve;
    });
    const restarted = loadPackagedWorker(
      source,
      "hoijjhgcckfhbcefoclgbhkgninnkknd",
      { local: storage.local, session: createPackagedWorkerStorage().session },
      { request, beforeBadgeWrite: () => blockedBadge },
    );
    await expect(restarted.sendMessage({ type: "store/backfill-status" })).resolves.toMatchObject({
      status: { pendingCount: 496 },
      initializing: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(restarted.requests).toEqual([]);
    eudicStatus = 200;
    await expect(
      restarted.sendMessage({ type: "store/backfill-check", expectedScope: scopeId }),
    ).resolves.toMatchObject({ status: { enabled: true, pendingCount: 496 }, checkError: null });
    try {
      await settled(restarted, (snapshot) => expect(snapshot.status.pendingCount).toBe(496));
      // Persisted discovery status is readable before the asynchronous Chrome badge write.
      expect(restarted.badges).toEqual([]);
    } finally {
      releaseBadge();
    }
    await vi.waitFor(() => expect(restarted.badges.at(-1)).toBe("496"), { timeout: 3_000 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
