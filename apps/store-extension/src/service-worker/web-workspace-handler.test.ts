import { describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { handleOpenWebWorkspace } from "./web-workspace-handler.js";

describe("Store Web workspace entry", () => {
  it("opens only the injected release-owned Web route without requiring tabs permission", async () => {
    const createTab = vi.fn(async () => undefined);

    await expect(
      handleOpenWebWorkspace(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/open-web-workspace" },
        "trusted-id",
        "trusted-id",
        "https://huayi.invalid/app/inbox",
        createTab,
      ),
    ).resolves.toEqual({
      messageVersion: STORE_MESSAGE_VERSION,
      opened: true,
      type: "store/open-web-workspace-result",
    });
    expect(createTab).toHaveBeenCalledWith({ url: "https://huayi.invalid/app/inbox" });
  });

  it("rejects non-extension senders and authority-bearing commands", async () => {
    const createTab = vi.fn(async () => undefined);
    await expect(
      handleOpenWebWorkspace(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/open-web-workspace",
          url: "https://attacker.invalid",
        },
        "trusted-id",
        "trusted-id",
        "https://huayi.invalid/app/inbox",
        createTab,
      ),
    ).resolves.toBeUndefined();
    await expect(
      handleOpenWebWorkspace(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/open-web-workspace" },
        "attacker-id",
        "trusted-id",
        "https://huayi.invalid/app/inbox",
        createTab,
      ),
    ).resolves.toBeUndefined();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("fails closed when the release-owned Web origin is not configured", async () => {
    const createTab = vi.fn(async () => undefined);
    await expect(
      handleOpenWebWorkspace(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/open-web-workspace" },
        "trusted-id",
        "trusted-id",
        null,
        createTab,
      ),
    ).resolves.toMatchObject({ opened: false, reason: "not-configured" });
    expect(createTab).not.toHaveBeenCalled();
  });

  it.each([
    "http://huayi.invalid/app/inbox",
    "https://user:password@huayi.invalid/app/inbox",
    "/app/inbox",
  ])("rejects an unsafe injected workspace URL: %s", async (webWorkspaceUrl) => {
    const createTab = vi.fn(async () => undefined);
    await expect(
      handleOpenWebWorkspace(
        { messageVersion: STORE_MESSAGE_VERSION, type: "store/open-web-workspace" },
        "trusted-id",
        "trusted-id",
        webWorkspaceUrl,
        createTab,
      ),
    ).resolves.toBeUndefined();
    expect(createTab).not.toHaveBeenCalled();
  });
});
