import { describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { handleCloudSessionMessage } from "./cloud-session-handler.js";

const request = (
  type:
    "store/cloud-session-disconnect" | "store/cloud-session-start" | "store/cloud-session-status",
) => ({
  messageVersion: STORE_MESSAGE_VERSION,
  type,
});

describe("privileged cloud-session handler", () => {
  it("accepts only this extension's popup or options page and returns sanitized state", async () => {
    const manager = {
      continuePairing: vi.fn(),
      disconnect: vi.fn(async () => ({ status: "disconnected" as const })),
      start: vi.fn(async () => ({
        expiresAt: "2026-08-13T01:00:00.000Z",
        status: "pairing" as const,
      })),
      status: vi.fn(async () => ({ status: "disconnected" as const })),
    };
    await expect(
      handleCloudSessionMessage(request("store/cloud-session-start"), {
        manager,
        runtimeId: "extension-id",
        schedulePoll: vi.fn(),
        sender: { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
      }),
    ).resolves.toMatchObject({ status: "pairing", type: "store/cloud-session-result" });
    expect(manager.start).toHaveBeenCalledOnce();
    await expect(
      handleCloudSessionMessage(request("store/cloud-session-start"), {
        manager,
        runtimeId: "extension-id",
        schedulePoll: vi.fn(),
        sender: { id: "extension-id", url: "chrome-extension://extension-id/content.js" },
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects extra URL authority before invoking the manager", async () => {
    const start = vi.fn();
    await expect(
      handleCloudSessionMessage(
        { ...request("store/cloud-session-start"), url: "https://attacker.invalid" },
        {
          manager: { continuePairing: vi.fn(), disconnect: vi.fn(), start, status: vi.fn() },
          runtimeId: "extension-id",
          schedulePoll: vi.fn(),
          sender: { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
        },
      ),
    ).resolves.toBeUndefined();
    expect(start).not.toHaveBeenCalled();
  });
});
