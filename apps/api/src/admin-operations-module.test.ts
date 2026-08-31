import { describe, expect, it, vi } from "vitest";

import {
  createAdminOperationsModule,
  type AdminOperationsRepository,
} from "./admin-operations-module.js";

const authorization = {
  actorUserId: "operator-1",
  reauthenticatedAt: new Date("2026-08-13T00:00:00.000Z"),
};
const usage = {
  accounts: { active: 0, deleting: 0, disabled: 0, total: 0 },
  analysisRequests: {
    failed: 0,
    p95LatencyMs: 0,
    repaired: 0,
    repairRatePercent: 0,
    succeeded: 0,
    successRatePercent: 0,
    terminal: 0,
  },
  killSwitch: { enabled: false, updatedAt: "2026-08-13T00:00:00.000Z" },
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  quota: { availableMicroUsd: 0, limitMicroUsd: 0, reservedMicroUsd: 0, usedMicroUsd: 0 },
  usageCalls: { failed: 0, succeeded: 0 },
};

function setup({
  invitationRecoveryTokenKey = new Uint8Array(32).fill(3),
  invitationTokenKey = new Uint8Array(32).fill(2),
}: {
  invitationRecoveryTokenKey?: Uint8Array;
  invitationTokenKey?: Uint8Array;
} = {}) {
  const repository: AdminOperationsRepository = {
    access: vi.fn(async () => undefined),
    execute: vi.fn(async (_authorization, command) =>
      command.type === "create-invitation"
        ? {
            consumedAt: null,
            createdAt: "2026-08-13T00:00:00.000Z",
            expiresAt: "2026-08-16T00:00:00.000Z",
            id: command.id,
            revokedAt: null,
          }
        : { id: "target-1", revoked: true },
    ),
    listAuditEvents: vi.fn(async () => ({ items: [], next: null })),
    listInvitations: vi.fn(async () => ({
      items: [],
      next: { createdAt: "2026-08-13T00:00:00.000Z", id: "invitation-1" },
    })),
    listUsers: vi.fn(async () => ({ items: [], next: null })),
    usage: vi.fn(async () => usage),
  };
  return {
    module: createAdminOperationsModule({
      cursorKey: new Uint8Array(32).fill(1),
      ids: () => "invitation-1",
      invitationRecoveryTokenKey,
      invitationTokenKey,
      repository,
    }),
    repository,
  };
}

describe("admin operations module", () => {
  it("uses resource-specific signed cursors and rejects cross-resource reuse", async () => {
    const { module } = setup();
    const invitations = await module.listInvitations(authorization, {});
    expect(invitations.nextCursor).toEqual(expect.any(String));
    await expect(
      module.listUsers(authorization, { cursor: invitations.nextCursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("derives one stable invitation path while repository sees a bounded command", async () => {
    const { module, repository } = setup();
    const first = await module.execute(authorization, {
      body: { expiresInHours: 72 },
      idempotencyKey: "same-key",
      type: "create-invitation",
    });
    const second = await module.execute(authorization, {
      body: { expiresInHours: 72 },
      idempotencyKey: "same-key",
      type: "create-invitation",
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ invitationPath: expect.stringMatching(/^\/join#[\w-]{43}$/u) });
    expect(JSON.stringify(vi.mocked(repository.execute).mock.calls)).not.toContain("join#");
  });

  it("recovers a selected invitation without accepting or exposing its old token", async () => {
    const { module, repository } = setup();
    vi.mocked(repository.execute).mockResolvedValueOnce({
      id: "invitation-1",
      recovered: true,
    });

    const recovered = await module.execute(authorization, {
      body: {},
      id: "invitation-1",
      idempotencyKey: "recover-1",
      type: "recover-invitation-token",
    });

    expect(recovered).toMatchObject({
      id: "invitation-1",
      invitationPath: expect.stringMatching(/^\/join#[\w-]{43}$/u),
      recovered: true,
    });
    expect(repository.execute).toHaveBeenCalledWith(
      authorization,
      expect.objectContaining({ id: "invitation-1", token: expect.any(String) }),
    );
    expect(JSON.stringify(vi.mocked(repository.execute).mock.calls)).not.toContain("oldToken");
  });

  it("keeps recovery replay stable when the unrelated refresh encryption key rotates", async () => {
    const first = setup({ invitationTokenKey: new Uint8Array(32).fill(2) });
    const rotated = setup({ invitationTokenKey: new Uint8Array(32).fill(4) });
    vi.mocked(first.repository.execute).mockResolvedValueOnce({
      id: "invitation-1",
      recovered: true,
    });
    vi.mocked(rotated.repository.execute).mockResolvedValueOnce({
      id: "invitation-1",
      recovered: true,
    });
    const command = {
      body: {},
      id: "invitation-1",
      idempotencyKey: "recover-1",
      type: "recover-invitation-token" as const,
    };

    await expect(first.module.execute(authorization, command)).resolves.toEqual(
      await rotated.module.execute(authorization, command),
    );
  });
});
