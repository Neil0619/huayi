import { describe, expect, it, vi } from "vitest";

import { createAdminOperationsApp } from "./admin-operations-app.js";
import {
  createAdminOperationsModule,
  type AdminOperationsRepository,
} from "./admin-operations-module.js";

const authorization = {
  actorUserId: "00000000-0000-0000-0000-000000000001",
  reauthenticatedAt: new Date("2026-08-13T06:00:00.000Z"),
};

function setup() {
  const repository: AdminOperationsRepository = {
    access: vi.fn(async () => undefined),
    execute: vi.fn(async (_authorization, command) => {
      if (command.type === "create-invitation") {
        return {
          consumedAt: null,
          createdAt: "2026-08-13T06:00:00.000Z",
          expiresAt: "2026-08-14T06:00:00.000Z",
          id: command.id,
          revokedAt: null,
        };
      }
      if (command.type === "revoke-invitation") {
        return { id: command.id, revoked: true as const };
      }
      return { id: "00000000-0000-0000-0000-000000000002", status: "disabled" };
    }),
    listAuditEvents: vi.fn(async () => ({ items: [], next: null })),
    listInvitations: vi.fn(async () => ({ items: [], next: null })),
    listUsers: vi.fn(async () => ({ items: [], next: null })),
    usage: vi.fn(async () => ({
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
    })),
  };
  const authenticate = vi.fn(async () => authorization);
  const app = createAdminOperationsApp({
    authenticate,
    module: createAdminOperationsModule({
      cursorKey: new Uint8Array(32).fill(1),
      ids: () => "80000000-0000-0000-0000-000000000001",
      invitationRecoveryTokenKey: new Uint8Array(32).fill(3),
      invitationTokenKey: new Uint8Array(32).fill(2),
      repository,
    }),
  });
  return { app, authenticate, repository };
}

describe("admin operations HTTP app", () => {
  it("serves no-store operator reads with normalized strict filters", async () => {
    const { app, authenticate, repository } = setup();
    const access = await app.request("/v1/admin/access");
    expect(access.status).toBe(200);
    expect(access.headers.get("cache-control")).toBe("private, no-store");
    await expect(access.json()).resolves.toEqual({ role: "operator" });
    const users = await app.request("/v1/admin/users?query=LEARNER&status=active&limit=10");
    expect(users.status).toBe(200);
    expect(repository.listUsers).toHaveBeenCalledWith(
      authorization,
      expect.objectContaining({ limit: 10, query: "learner", status: "active" }),
    );
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("requires the global write key and returns only the one-time invitation path", async () => {
    const { app, authenticate } = setup();
    const response = await app.request("/v1/admin/invitations", {
      body: JSON.stringify({ expiresInHours: 24 }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "invite-key" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      invitationPath: expect.stringMatching(/^\/join#[\w-]{43}$/u),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("routes invitation revocation through mutation authentication and no-store response", async () => {
    const { app, authenticate, repository } = setup();
    const invitationId = "80000000-0000-0000-0000-000000000001";
    const response = await app.request(`/v1/admin/invitations/${invitationId}`, {
      body: "{}",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "revoke-key" },
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ id: invitationId, revoked: true });
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), true);
    expect(repository.execute).toHaveBeenCalledWith(
      authorization,
      expect.objectContaining({ id: invitationId, type: "revoke-invitation" }),
    );
  });

  it("routes one invitation token recovery through mutation authentication", async () => {
    const { app, authenticate, repository } = setup();
    vi.mocked(repository.execute).mockResolvedValueOnce({
      id: "80000000-0000-0000-0000-000000000001",
      recovered: true,
    });
    const response = await app.request(
      "/v1/admin/invitations/80000000-0000-0000-0000-000000000001/token-recovery",
      {
        body: "{}",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "recover-key" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authenticate).toHaveBeenCalledWith(expect.anything(), true);
    await expect(response.json()).resolves.toMatchObject({
      invitationPath: expect.stringMatching(/^\/join#[\w-]{43}$/u),
      recovered: true,
    });
  });
});
