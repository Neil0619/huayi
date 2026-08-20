import { describe, expect, it, vi } from "vitest";

import { createInMemoryPasswordRecovery } from "./in-memory-password-recovery.js";
import { createPasswordRecoveryModule } from "./password-recovery-module.js";
import type { PasswordRecoveryProvider } from "./password-recovery-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

function setup() {
  const clock = new MutableClock("2026-08-14T10:00:00.000Z");
  const eligible = new Map([
    ["learner@example.com", { email: "learner@example.com", userId: "auth-user-a" }],
  ]);
  const revoked: string[] = [];
  const notified: string[] = [];
  const repository = createInMemoryPasswordRecovery({
    clock,
    findEligibleAccount: (email) => eligible.get(email),
    notifyPasswordReset: (userId) => {
      notified.push(userId);
    },
    pepper: "test-pepper-at-least-32-characters",
    protectFlowSecret: (value) => `flow:${value}`,
    revokeAllSessions: (userId) => {
      revoked.push(userId);
    },
    secrets: new DeterministicSecrets(),
    unprotectFlowSecret: (value) => value.replace(/^flow:/u, ""),
    webOrigin: "https://app.huayi.example",
  });
  const provider: PasswordRecoveryProvider = {
    begin: vi.fn().mockResolvedValue({ authState: { verifier: "pkce-state" } }),
    exchange: vi.fn().mockResolvedValue({
      authState: { session: "recovery-state" },
      email: "learner@example.com",
      userId: "auth-user-a",
    }),
    updatePassword: vi.fn().mockResolvedValue({
      authState: { session: "updated-state" },
      userId: "auth-user-a",
    }),
  };
  const recovery = createPasswordRecoveryModule({
    apiOrigin: "https://api.huayi.example",
    protectTransientAuthState: (value) => `state:${value}`,
    provider,
    repository,
    unprotectTransientAuthState: (value) => value.replace(/^state:/u, ""),
  });
  return { clock, eligible, notified, provider, recovery, repository, revoked };
}

describe("in-memory PasswordRecovery state machine", () => {
  it("queues only an eligible password owner and makes only the newest flow usable", async () => {
    const { provider, recovery, repository } = setup();

    await recovery.request({ email: "unknown@example.com", ipBucket: "ip-a" });
    expect(repository.inspect()).toEqual({ completed: 0, failed: 0, open: 0, requested: 0 });
    expect(provider.begin).not.toHaveBeenCalled();

    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-b" });
    expect(repository.inspect()).toEqual({ completed: 0, failed: 1, open: 1, requested: 1 });

    await expect(recovery.dispatchNext()).resolves.toBe("sent");
    await expect(recovery.dispatchNext()).resolves.toBe("idle");
    expect(provider.begin).toHaveBeenCalledOnce();
  });

  it("completes one same-owner recovery, revokes sessions, and enqueues one notification", async () => {
    const { notified, provider, recovery, repository, revoked } = setup();
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    await recovery.dispatchNext();
    const redirectTo = vi.mocked(provider.begin).mock.calls[0]?.[0].redirectTo;
    const flowId = new URL(redirectTo ?? "").searchParams.get("flow");
    expect(flowId).not.toBeNull();

    const browser = await recovery.callback({ code: "provider-code", flowId: flowId ?? "" });
    const session = await recovery.readSession({
      origin: "https://app.huayi.example",
      recoverySessionId: browser.recoverySessionId,
    });
    expect(session.csrfToken).not.toBe(browser.csrfToken);
    await recovery.complete({
      csrfToken: session.csrfToken,
      origin: "https://app.huayi.example",
      password: "correct horse battery staple",
      recoverySessionId: browser.recoverySessionId,
    });

    expect(provider.updatePassword).toHaveBeenCalledWith({
      authState: { session: "recovery-state" },
      password: "correct horse battery staple",
    });
    expect(revoked).toEqual(["auth-user-a"]);
    expect(notified).toEqual(["auth-user-a"]);
    expect(repository.inspect()).toEqual({ completed: 1, failed: 0, open: 0, requested: 0 });
    await expect(
      recovery.readSession({
        origin: "https://app.huayi.example",
        recoverySessionId: browser.recoverySessionId,
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });

  it("fails closed when callback identity no longer matches the eligible owner", async () => {
    const { provider, recovery, repository } = setup();
    vi.mocked(provider.exchange).mockResolvedValue({
      authState: { session: "other-state" },
      email: "other@example.com",
      userId: "auth-user-b",
    });
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    await recovery.dispatchNext();
    const redirectTo = vi.mocked(provider.begin).mock.calls[0]?.[0].redirectTo;
    const flowId = new URL(redirectTo ?? "").searchParams.get("flow") ?? "";

    await expect(recovery.callback({ code: "provider-code", flowId })).rejects.toMatchObject({
      code: "authentication_required",
    });
    expect(repository.inspect()).toEqual({ completed: 0, failed: 1, open: 0, requested: 0 });
  });

  it("rechecks account and password-method eligibility immediately before completion", async () => {
    const { eligible, provider, recovery, repository } = setup();
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    await recovery.dispatchNext();
    const redirectTo = vi.mocked(provider.begin).mock.calls[0]?.[0].redirectTo;
    const flowId = new URL(redirectTo ?? "").searchParams.get("flow") ?? "";
    const browser = await recovery.callback({ code: "provider-code", flowId });
    eligible.delete("learner@example.com");

    await expect(
      recovery.complete({
        csrfToken: browser.csrfToken,
        origin: "https://app.huayi.example",
        password: "correct horse battery staple",
        recoverySessionId: browser.recoverySessionId,
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
    expect(provider.updatePassword).not.toHaveBeenCalled();
    expect(repository.inspect()).toEqual({ completed: 0, failed: 1, open: 0, requested: 0 });
  });

  it("does not transparently redispatch after the durable dispatch marker", async () => {
    const { clock, recovery, repository } = setup();
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    const dispatch = await repository.claimDispatch();
    expect(dispatch).toBeDefined();
    await repository.markDispatched(dispatch?.flowId ?? "", dispatch?.leaseId ?? "");
    clock.advance(61_000);

    await expect(recovery.dispatchNext()).resolves.toBe("idle");
    expect(repository.inspect()).toEqual({ completed: 0, failed: 1, open: 0, requested: 0 });
  });

  it("does not dispatch after the account or password method becomes ineligible", async () => {
    const { eligible, provider, recovery, repository } = setup();
    await recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    eligible.delete("learner@example.com");

    await expect(recovery.dispatchNext()).resolves.toBe("idle");
    expect(provider.begin).not.toHaveBeenCalled();
    expect(repository.inspect()).toEqual({ completed: 0, failed: 1, open: 0, requested: 0 });
  });

  it("expires the 30-minute flow and 15-minute browser capability", async () => {
    const first = setup();
    await first.recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    first.clock.advance(30 * 60_000 + 1);
    await expect(first.recovery.dispatchNext()).resolves.toBe("idle");

    const second = setup();
    await second.recovery.request({ email: "learner@example.com", ipBucket: "ip-a" });
    await second.recovery.dispatchNext();
    const redirectTo = vi.mocked(second.provider.begin).mock.calls[0]?.[0].redirectTo;
    const flowId = new URL(redirectTo ?? "").searchParams.get("flow") ?? "";
    const browser = await second.recovery.callback({ code: "provider-code", flowId });
    second.clock.advance(15 * 60_000 + 1);
    await expect(
      second.recovery.readSession({
        origin: "https://app.huayi.example",
        recoverySessionId: browser.recoverySessionId,
      }),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });
});
