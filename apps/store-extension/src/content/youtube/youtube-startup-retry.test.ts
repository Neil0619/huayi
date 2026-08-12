import { describe, expect, it, vi } from "vitest";

import { createYouTubeStartupRetryExecutor } from "./youtube-startup-retry.js";

describe("Store YouTube startup retry", () => {
  it("uses one fixed wait before recovering on the second attempt", async () => {
    const waitForRetry = vi.fn(async () => undefined);
    const runStartupStep = createYouTubeStartupRetryExecutor({ waitForRetry });
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("worker starting"))
      .mockResolvedValueOnce("ready");

    await expect(runStartupStep(operation)).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(waitForRetry).toHaveBeenCalledOnce();
  });

  it("stops after exactly three attempts and two waits", async () => {
    const waitForRetry = vi.fn(async () => undefined);
    const runStartupStep = createYouTubeStartupRetryExecutor({ waitForRetry });
    const unavailable = new Error("worker unavailable");
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(unavailable);

    await expect(runStartupStep(operation)).rejects.toBe(unavailable);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(waitForRetry).toHaveBeenCalledTimes(2);
  });
});
