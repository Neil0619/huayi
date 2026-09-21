// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { BUILD_FIXTURE_TIMEOUT_MS } from "./build-fixture.test-support.js";
import { createStoreExtensionConfig } from "../vite.config.js";
import { createPackagedWorkerStorage, loadPackagedWorker } from "./packaged-worker.test-support.js";
import { createChromeStoreSettings } from "./service-worker/store-settings.js";
import { createBrowserDeviceVault } from "./vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "./vault/chrome-vault-storage.js";

function modelStream(model: string): Response {
  const chunks = [
    { delta: { role: "assistant", content: "" }, finish_reason: null },
    { delta: { content: '{"translationZh":"你好，世界🌍。"}' }, finish_reason: null },
    { delta: {}, finish_reason: "stop" },
  ];
  const text =
    chunks
      .map(
        (chunk) =>
          `data: ${JSON.stringify({
            choices: [{ ...chunk, index: 0, logprobs: null }],
            created: 1,
            id: "offline-packaged-flash",
            model,
            object: "chat.completion.chunk",
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n";
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

let source: string;
let directory: string | undefined;
beforeAll(async () => {
  if (process.env.HUAYI_STORE_E2E_PACKAGE_PROFILE === "production") {
    source = await readFile(
      new URL("../dist-production/service-worker.js", import.meta.url),
      "utf8",
    );
  } else {
    directory = await mkdtemp(join(tmpdir(), "huayi-packaged-byok-"));
    const config = createStoreExtensionConfig("background", "production");
    await build({ ...config, configFile: false, build: { ...config.build, outDir: directory } });
    source = await readFile(join(directory, "service-worker.js"), "utf8");
  }
}, BUILD_FIXTURE_TIMEOUT_MS);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("the production package uses canonical DeepSeek BYOK without a Cloud session or fallback", async () => {
  for (const model of ["deepseek-flash", "deepseek-v4-pro"]) {
    const storage = createPackagedWorkerStorage();
    const settings = createChromeStoreSettings(storage.local);
    await settings.setProvider("deepseek");
    await settings.grantNetworkConsent(new Date());
    const vault = createBrowserDeviceVault({
      crypto: globalThis.crypto,
      storage: createChromeVaultStorageAdapter(storage),
    });
    await vault.setCredential("deepseek-api-key", "fictional-packaged-byok-key");
    const request = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async () =>
      modelStream(model),
    );
    const worker = loadPackagedWorker(source, "kehpghgppccjlmahanlmeagnpnfbcnea", storage, {
      request,
    });
    const port = worker.connect();
    try {
      port.post({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/analysis-start",
        action: "translate",
        boundaryEvidence: { kind: "local-rules" },
        selection: "Hello world.",
        sentenceContext: null,
      });
      const expected =
        model === "deepseek-flash"
          ? {
              type: "store/analysis-result",
              result: expect.objectContaining({
                type: "translate-passage",
                sourceText: "Hello world.",
                translationZh: "你好，世界🌍。",
              }),
            }
          : { type: "store/analysis-error", code: "invalid-response" };
      await vi.waitFor(() =>
        expect(port.messages).toEqual(expect.arrayContaining([expect.objectContaining(expected)])),
      );
      expect(request).toHaveBeenCalledTimes(1);
      const [url, init] = request.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe("https://api.deepseek.com/chat/completions");
      expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error" });
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer fictional-packaged-byok-key",
      );
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        stream: true,
      });
      expect(worker.requests).toEqual([
        { method: "POST", url: "https://api.deepseek.com/chat/completions" },
      ]);
      if (model !== "deepseek-flash") {
        expect(port.messages).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "store/analysis-result" })]),
        );
      }
    } finally {
      port.disconnect();
    }
  }
});
