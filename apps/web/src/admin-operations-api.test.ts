import { describe, expect, it, vi } from "vitest";

import {
  createWebAdminOperationsApi,
  type WebAdminOperationsApiOptions,
} from "./admin-operations-api.js";

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

  it("replays an ambiguous invitation creation with the same idempotency key", async () => {
    const created = {
      consumedAt: null,
      createdAt: "2026-08-13T06:00:00.000Z",
      expiresAt: "2026-08-14T06:00:00.000Z",
      id: "80000000-0000-0000-0000-000000000001",
      invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      revokedAt: null,
    };
    const fetch = vi
      .fn<WebAdminOperationsApiOptions["fetch"]>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }));
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });

    await expect(api.createInvitation(24, "csrf-token")).rejects.toThrow("response lost");
    await expect(api.createInvitation(24, "csrf-token", true)).resolves.toEqual(created);

    const firstKey = new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key");
    const retryKey = new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key");
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);
    expect(retryKey).toBe(firstKey);

    await api.createInvitation(24, "csrf-token");
    const nextAttemptKey = new Headers(fetch.mock.calls[2]?.[1]?.headers).get("idempotency-key");
    expect(nextAttemptKey).not.toBe(firstKey);
  });

  it("uses the fixed invitation DELETE route with Cookie, CSRF, and one idempotency key", async () => {
    const invitationId = "80000000-0000-0000-0000-000000000001";
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ id: invitationId, revoked: true }), { status: 200 });
    });
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });

    await expect(api.revokeInvitation(invitationId, "csrf-token")).resolves.toEqual({
      id: invitationId,
      revoked: true,
    });
    const [input, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(input).toEqual(
      new URL(`https://api.huayi.example/v1/admin/invitations/${invitationId}`),
    );
    expect(init).toMatchObject({ body: "{}", credentials: "include", method: "DELETE" });
    expect(new Headers(init?.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(new Headers(init?.headers).get("idempotency-key")).toEqual(expect.any(String));
  });

  it("recovers an ambiguous token rotation with the same bounded request", async () => {
    const invitationId = "80000000-0000-0000-0000-000000000001";
    const recovered = {
      id: invitationId,
      invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
      recovered: true as const,
    };
    const fetch = vi
      .fn<WebAdminOperationsApiOptions["fetch"]>()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify(recovered), { status: 200 }));
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });

    await expect(api.recoverInvitationToken(invitationId, "csrf-token")).rejects.toThrow(
      "response lost",
    );
    await expect(api.recoverInvitationToken(invitationId, "csrf-token", true)).resolves.toEqual(
      recovered,
    );
    expect(
      fetch.mock.calls.map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual([expect.any(String), expect.any(String)]);
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key")).toBe(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
    );
    expect(fetch.mock.calls[0]?.[0]).toEqual(
      new URL(`https://api.huayi.example/v1/admin/invitations/${invitationId}/token-recovery`),
    );
  });

  it("clears token recovery retry state after an explicit server rejection", async () => {
    const invitationId = "80000000-0000-0000-0000-000000000001";
    const rejected = new Response(
      JSON.stringify({
        error: {
          code: "revision_conflict",
          message: "state changed",
          requestId: "request-1",
        },
      }),
      { status: 409 },
    );
    const fetch = vi
      .fn<WebAdminOperationsApiOptions["fetch"]>()
      .mockResolvedValueOnce(rejected)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: invitationId,
            invitationPath: "/join#abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
            recovered: true,
          }),
          { status: 200 },
        ),
      );
    const api = createWebAdminOperationsApi({ apiOrigin: "https://api.huayi.example", fetch });

    await expect(api.recoverInvitationToken(invitationId, "csrf-token")).rejects.toMatchObject({
      code: "revision_conflict",
    });
    await expect(api.recoverInvitationToken(invitationId, "csrf-token")).resolves.toMatchObject({
      recovered: true,
    });
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("idempotency-key")).not.toBe(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("idempotency-key"),
    );
  });
});
