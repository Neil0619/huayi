import { readFileSync } from "node:fs";

import type { DeviceVault, StoreWordbookRequest } from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WordbookOptionsController } from "./wordbook-options-controller.js";

const optionsHtml = readFileSync("apps/store-extension/pages/options.html", "utf8");

function vault(): DeviceVault {
  return {
    deleteCredential: vi.fn(async () => undefined),
    ensureReady: vi.fn(async () => undefined),
    getDek: vi.fn(async () => new Uint8Array(32)),
    getCredential: vi.fn(async () => "Bearer private-eudic-value"),
    getReadiness: vi.fn(async () => "ready" as const),
    migrateLegacy: vi.fn(async () => undefined),
    setCredential: vi.fn(async () => undefined),
  };
}

function response(message: StoreWordbookRequest): unknown {
  if (message.type === "store/eudic-import-status") {
    return {
      job: {
        duplicateCount: 3,
        importedCount: 5_000,
        nextPage: 51,
        state: "source-limit-reached",
        updatedAt: "2026-08-11T00:00:00.000Z",
      },
      messageVersion: STORE_MESSAGE_VERSION,
      type: "store/eudic-import-result",
    };
  }
  if (message.type === "store/outbox-list") {
    return { items: [], messageVersion: STORE_MESSAGE_VERSION, type: "store/outbox-result" };
  }
  return {
    code: "network-error",
    messageVersion: STORE_MESSAGE_VERSION,
    type: "store/wordbook-error",
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
  vi.restoreAllMocks();
});

describe("Store wordbook Options controller", () => {
  it("never renders Eudic credentials and makes the public source limit visible", async () => {
    document.documentElement.innerHTML = optionsHtml;
    const credentials = vault();
    const sendMessage = vi.fn(async (message: StoreWordbookRequest) => response(message));
    const controller = new WordbookOptionsController({ sendMessage, vault: credentials });
    await controller.initialize(true);

    expect(document.body.textContent).not.toContain("private-eudic-value");
    expect(document.querySelector("[data-eudic-auth-status]")?.textContent).toBe("已配置");
    expect(document.querySelector<HTMLInputElement>("[data-eudic-auth-input]")?.placeholder).toBe(
      "••••••••",
    );
    expect(document.body.textContent).toContain("同步任务在 Web 管理");
    expect(document.body.textContent).toContain("输入框显示圆点占位");
    expect(document.body.textContent).not.toContain("任务由语见云端统一管理");
    expect(document.querySelector("[data-eudic-import-progress]")?.textContent).toContain(
      "不是完整导入",
    );

    document.querySelector<HTMLButtonElement>("[data-eudic-import-step]")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-wordbook-status]")?.textContent).toBe(
        "欧路网络请求失败；任务没有自动重试。",
      ),
    );
  });

  it.each([
    ["consent-required", "请先在“外部词典数据”中同意欧路"],
    ["data-corrupt", "清除扩展数据后重新配置"],
    ["recipient-disabled", "欧路导入与导出已停用"],
  ] as const)("renders a stable Eudic recipient policy error", async (code, expected) => {
    document.documentElement.innerHTML = optionsHtml;
    const sendMessage = vi.fn(async (message: StoreWordbookRequest) => {
      if (message.type === "store/eudic-import-status") return response(message);
      if (message.type === "store/outbox-list") return response(message);
      return { code, messageVersion: STORE_MESSAGE_VERSION, type: "store/wordbook-error" };
    });
    const controller = new WordbookOptionsController({ sendMessage, vault: vault() });
    await controller.initialize(true);

    document.querySelector<HTMLButtonElement>("[data-eudic-import-step]")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-wordbook-status]")?.textContent).toContain(expected),
    );
  });
});
