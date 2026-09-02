import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreSiteLifecycle } from "./site-lifecycle-registry.js";

function policy(enabled: boolean) {
  return {
    appearance: "silver" as const,
    defaultAction: "explain" as const,
    enabled,
    globallyEnabled: true,
    host: "example.com",
    messageVersion: STORE_MESSAGE_VERSION,
    overlayTheme: "pearl" as const,
    type: "store/site-policy-result" as const,
  };
}

describe("Store shared site lifecycle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts registered participants only after an allowed worker policy", async () => {
    const ordinary = { start: vi.fn(), stop: vi.fn(), update: vi.fn() };
    const youtube = { start: vi.fn(), stop: vi.fn() };
    const lifecycle = new StoreSiteLifecycle(vi.fn(async () => policy(true)));

    lifecycle.register("ordinary", ordinary);
    lifecycle.register("youtube", youtube);
    expect(ordinary.start).not.toHaveBeenCalled();
    expect(youtube.start).not.toHaveBeenCalled();

    await lifecycle.refresh();
    expect(ordinary.update).toHaveBeenCalledWith(policy(true));
    expect(ordinary.start).toHaveBeenCalledOnce();
    expect(youtube.start).toHaveBeenCalledOnce();
  });

  it("stops every participant immediately while a disable toggle is persisted", async () => {
    let finishToggle: ((value: unknown) => void) | undefined;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(policy(true))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishToggle = resolve;
          }),
      );
    const ordinary = { start: vi.fn(), stop: vi.fn() };
    const youtube = { start: vi.fn(), stop: vi.fn() };
    const lifecycle = new StoreSiteLifecycle(sendMessage);
    lifecycle.register("ordinary", ordinary);
    lifecycle.register("youtube", youtube);
    await lifecycle.refresh();

    const toggled = lifecycle.toggle(false);
    expect(ordinary.stop).toHaveBeenCalledOnce();
    expect(youtube.stop).toHaveBeenCalledOnce();
    finishToggle?.(policy(false));
    await toggled;
  });

  it("fails closed and stops active participants when refresh cannot be verified", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(policy(true))
      .mockRejectedValueOnce(new Error("worker unavailable"));
    const participant = { start: vi.fn(), stop: vi.fn() };
    const lifecycle = new StoreSiteLifecycle(sendMessage);
    lifecycle.register("ordinary", participant);
    await lifecycle.refresh();

    await expect(lifecycle.refresh()).rejects.toThrow("worker unavailable");
    expect(participant.stop).toHaveBeenCalledOnce();
  });
});
