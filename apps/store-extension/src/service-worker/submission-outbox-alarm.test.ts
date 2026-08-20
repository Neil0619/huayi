import { describe, expect, it, vi } from "vitest";

import { runSubmissionOutboxAlarm } from "./submission-outbox-alarm.js";

describe("SubmissionOutbox alarm recovery", () => {
  it("reschedules pending and unexpected local failures without exposing payload", async () => {
    const schedule = vi.fn();
    await runSubmissionOutboxAlarm(
      { process: vi.fn(async () => ({ pending: true, status: "retry" as const })) },
      schedule,
    );
    await runSubmissionOutboxAlarm(
      { process: vi.fn(async () => Promise.reject(new Error("storage unavailable"))) },
      schedule,
    );
    expect(schedule).toHaveBeenCalledTimes(2);

    await runSubmissionOutboxAlarm(
      {
        process: vi.fn(async () => ({
          pending: false,
          status: "client-upgrade-required" as const,
        })),
      },
      schedule,
    );
    expect(schedule).toHaveBeenCalledTimes(2);

    await runSubmissionOutboxAlarm(
      {
        process: vi.fn(async () => ({ pending: false, status: "not-configured" as const })),
      },
      schedule,
    );
    expect(schedule).toHaveBeenCalledTimes(2);
  });
});
