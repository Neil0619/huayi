import { describe, expect, it, vi } from "vitest";

import { createWebAdminOperationsApi } from "./admin-operations-api.js";

const usage = {
  accounts: { active: 1, deleting: 0, disabled: 0, total: 1 },
  analysisRequests: {
    failed: 0,
    p95LatencyMs: 0,
    repaired: 0,
    repairRatePercent: 0,
    succeeded: 0,
    successRatePercent: 0,
    terminal: 0,
  },
  killSwitch: { enabled: false, updatedAt: "2026-08-13T06:00:00.000Z" },
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  quota: { availableMicroUsd: 0, limitMicroUsd: 0, reservedMicroUsd: 0, usedMicroUsd: 0 },
  usageCalls: { failed: 0, succeeded: 0 },
};

describe("Web admin operations API", () => {
  it("uses fixed Cookie reads and strictly parses safe metadata", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(usage), { status: 200 }));
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });
    await expect(api.getUsage()).resolves.toEqual(usage);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://api.huayi.example/v1/admin/usage"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends CSRF and one idempotency key for bounded mutations", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({
          consumedAt: null,
          createdAt: "2026-08-13T06:00:00.000Z",
          expiresAt: "2026-08-14T06:00:00.000Z",
          id: "80000000-0000-0000-0000-000000000001",
          invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
          revokedAt: null,
        }),
        { status: 201 },
      );
    });
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });
    await api.createInvitation(24, "csrf-token");
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init).toMatchObject({ credentials: "include", method: "POST" });
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(new Headers(init?.headers).get("idempotency-key")).toEqual(expect.any(String));
  });
});
