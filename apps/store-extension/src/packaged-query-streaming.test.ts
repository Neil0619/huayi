// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import type { ExtensionQueryEvent, LearningTaskSnapshot } from "@huayi/cloud-contracts";

import { createStoreExtensionConfig } from "../vite.config.js";
import { createPackagedWorkerStorage, loadPackagedWorker } from "./packaged-worker.test-support.js";
import { createChromeStoreSettings } from "./service-worker/store-settings.js";
import { createExtensionSessionVault } from "./service-worker/extension-session-vault.js";
import { createBrowserDeviceVault } from "./vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "./vault/chrome-vault-storage.js";

it("the packaged worker streams v2 task previews, reconnects without resubmission and caches across restart", async () => {
  const storage = createPackagedWorkerStorage();
  await createChromeStoreSettings(storage.local).grantNetworkConsent(new Date());
  const adapter = createChromeVaultStorageAdapter(storage);
  const vault = createBrowserDeviceVault({ crypto: globalThis.crypto, storage: adapter });
  const sessionVault = createExtensionSessionVault({
    crypto: globalThis.crypto,
    deviceVault: vault,
    storage: {
      read: adapter.readPersistent,
      write: adapter.writePersistent,
      delete: adapter.deletePersistent,
    },
  });
  await sessionVault.writeSession({
    expiresAt: "2099-01-01T00:00:00.000Z",
    token: "fictional-packaged-query-session".repeat(2),
    preferencesSyncedAt: Date.now(),
    preferences: {
      cloudWordCopyMode: "enabled",
      extensionQueryModelMode: "platform",
      revision: 5,
      studyCaptureMode: "manual",
      updatedAt: "2026-09-05T00:00:00.000Z",
    },
  });
  const directory = await mkdtemp(join(tmpdir(), "huayi-packaged-query-"));
  try {
    let source: string;
    if (process.env.HUAYI_STORE_E2E_PACKAGE_PROFILE === "hosted") {
      source = await readFile(new URL("../dist/service-worker.js", import.meta.url), "utf8");
    } else {
      const config = createStoreExtensionConfig("background", "hosted-acceptance");
      await build({ ...config, configFile: false, build: { ...config.build, outDir: directory } });
      source = await readFile(join(directory, "service-worker.js"), "utf8");
    }
    const task: LearningTaskSnapshot = {
      version: 2,
      id: "00000000-0000-4000-8000-000000000001",
      kind: "instant-query",
      subjectId: null,
      state: "running",
      cursor: 0,
      error: null,
      output: null,
      timings: {},
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
    };
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cursor = 0;
    const emit = (payload: ExtensionQueryEvent) => {
      cursor += 1;
      const frame = `event: learning-task\nid: ${cursor}\ndata: ${JSON.stringify({ version: 2, taskId: task.id, cursor, payload })}\n\n`;
      // Actual wire bytes deliberately split inside Chinese and emoji characters.
      for (const byte of new TextEncoder().encode(frame)) stream?.enqueue(Uint8Array.of(byte));
    };
    const request = vi.fn(async (url: URL, init?: RequestInit) => {
      if (url.pathname === "/v2/learning-tasks" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({ version: 2, kind: "instant-query" });
        return Response.json(task);
      }
      if (url.pathname === `/v2/learning-tasks/${task.id}/events`) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
          }),
          {
            headers: { "content-type": "text/event-stream" },
          },
        );
      }
      throw new Error(`Unexpected offline request: ${url.pathname}`);
    });
    const worker = loadPackagedWorker(source, "hoijjhgcckfhbcefoclgbhkgninnkknd", storage, {
      request,
    });
    const start = {
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/analysis-start",
      action: "explain",
      boundaryEvidence: { kind: "local-rules" },
      selection: "The plan fell through.",
      sentenceContext: null,
    };
    const first = worker.connect();
    first.post(start);
    await vi.waitFor(() => expect(stream, JSON.stringify(worker.requests)).toBeDefined());
    emit({ type: "query.started", generationId: "generation-1" });
    emit({
      type: "query.preview-v2",
      version: 2,
      generationId: "generation-1",
      update: {
        type: "delta",
        requestId: "generation-1",
        sequence: 0,
        section: "main-structure",
        text: "主语 + 谓语😀",
      },
    });
    const preview = {
      type: "store/analysis-update",
      update: { type: "delta", text: "主语 + 谓语😀" },
    };
    await vi.waitFor(() =>
      expect(first.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "store/analysis-update",
            update: expect.objectContaining(preview.update),
          }),
        ]),
      ),
    );
    expect(first.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "store/analysis-result" })]),
    );
    first.disconnect();
    const reopened = worker.connect();
    reopened.post(start);
    await vi.waitFor(() =>
      expect(reopened.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: preview.type,
            update: expect.objectContaining(preview.update),
          }),
        ]),
      ),
    );
    const result = {
      type: "explain-sentence" as const,
      requestId: "generation-1",
      selectionKind: "sentence" as const,
      sourceText: start.selection,
      mainStructure: "主语 + 谓语😀",
      keyExpressions: [{ text: "fell through", meaningZh: "落空" }],
      translationZh: "计划落空了。",
      contextRole: "说明计划的结果。",
    };
    emit({
      type: "query.completed",
      generationId: "generation-1",
      result,
      quota: {
        availableMicroUsd: 900,
        limitMicroUsd: 1000,
        percentUsed: 10,
        reservedMicroUsd: 0,
        usedMicroUsd: 100,
        warning: "available",
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-10-01T00:00:00.000Z",
      },
    });
    await vi.waitFor(() =>
      expect(reopened.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "store/analysis-result" })]),
      ),
    );
    reopened.disconnect();
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    const restartedRequest = vi.fn(async () => {
      throw new Error("Cache hit must not request a task.");
    });
    const restarted = loadPackagedWorker(source, "hoijjhgcckfhbcefoclgbhkgninnkknd", storage, {
      request: restartedRequest,
    }).connect();
    restarted.post(start);
    await vi.waitFor(() =>
      expect(restarted.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "store/analysis-result" })]),
      ),
    );
    expect(restartedRequest).not.toHaveBeenCalled();
    restarted.disconnect();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
