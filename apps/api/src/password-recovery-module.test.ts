import { describe, expect, it, vi } from "vitest";

import { createPasswordRecoveryModule } from "./password-recovery-module.js";
import type { PasswordRecoveryProvider } from "./password-recovery-provider.js";

describe("PasswordRecovery module", () => {
  it("keeps public request local and marks dispatch before starting the provider", async () => {
    const events: string[] = [];
    const repository = {
      callback: vi.fn(),
      claimCompletion: vi.fn(),
      claimDispatch: vi.fn().mockImplementation(() => {
        events.push("claim");
        return {
          email: "learner@example.com",
          flowId: "flow-a",
          leaseId: "dispatch-lease",
        };
      }),
      complete: vi.fn(),
      failDispatch: vi.fn(),
      markDispatched: vi.fn().mockImplementation(() => events.push("mark-dispatched")),
      readProviderState: vi.fn(),
      readSession: vi.fn(),
      request: vi.fn().mockImplementation(() => events.push("request-local")),
      saveProviderUpdated: vi.fn(),
      saveSent: vi.fn().mockImplementation(() => events.push("save-sent")),
    };
    const provider: PasswordRecoveryProvider = {
      begin: vi.fn().mockImplementation(() => {
        events.push("provider-begin");
        return { authState: { verifier: "state-a" } };
      }),
      exchange: vi.fn(),
      updatePassword: vi.fn(),
    };
    const recovery = createPasswordRecoveryModule({
      apiOrigin: "https://api.huayi.example",
      protectTransientAuthState: (value) => `protected:${value}`,
      provider,
      repository,
      unprotectTransientAuthState: (value) => value.replace(/^protected:/u, ""),
    });

    await recovery.request({ email: "learner@example.com", ipBucket: "ip-bucket" });
    expect(events).toEqual(["request-local"]);
    expect(provider.begin).not.toHaveBeenCalled();

    await expect(recovery.dispatchNext()).resolves.toBe("sent");
    expect(events).toEqual([
      "request-local",
      "claim",
      "mark-dispatched",
      "provider-begin",
      "save-sent",
    ]);
    expect(provider.begin).toHaveBeenCalledWith({
      email: "learner@example.com",
      redirectTo: "https://api.huayi.example/v1/auth/password/recovery/confirm?flow=flow-a",
    });
    expect(repository.saveSent).toHaveBeenCalledWith(
      "flow-a",
      "dispatch-lease",
      'protected:{"verifier":"state-a"}',
    );
  });

  it("returns bounded idle/failed outcomes and terminalizes an ambiguous dispatch", async () => {
    const repository = {
      callback: vi.fn(),
      claimCompletion: vi.fn(),
      claimDispatch: vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce({
        email: "learner@example.com",
        flowId: "flow-a",
        leaseId: "dispatch-lease",
      }),
      complete: vi.fn(),
      failDispatch: vi.fn(),
      markDispatched: vi.fn(),
      readProviderState: vi.fn(),
      readSession: vi.fn(),
      request: vi.fn(),
      saveProviderUpdated: vi.fn(),
      saveSent: vi.fn(),
    };
    const provider: PasswordRecoveryProvider = {
      begin: vi.fn().mockRejectedValue(new Error("ambiguous provider failure")),
      exchange: vi.fn(),
      updatePassword: vi.fn(),
    };
    const recovery = createPasswordRecoveryModule({
      apiOrigin: "https://api.huayi.example",
      protectTransientAuthState: (value) => value,
      provider,
      repository,
      unprotectTransientAuthState: (value) => value,
    });

    await expect(recovery.dispatchNext()).resolves.toBe("idle");
    await expect(recovery.dispatchNext()).resolves.toBe("failed");
    expect(repository.markDispatched).toHaveBeenCalledBefore(repository.failDispatch);
    expect(repository.failDispatch).toHaveBeenCalledWith("flow-a", "dispatch-lease");
    expect(repository.saveSent).not.toHaveBeenCalled();
  });

  it("exchanges one callback and persists only protected provider state", async () => {
    const repository = {
      callback: vi.fn().mockResolvedValue({
        csrfToken: "c".repeat(32),
        expiresAt: new Date("2026-08-14T10:15:00.000Z"),
        recoverySessionId: "recovery-session",
      }),
      claimCompletion: vi.fn(),
      claimDispatch: vi.fn(),
      complete: vi.fn(),
      failDispatch: vi.fn(),
      markDispatched: vi.fn(),
      readProviderState: vi.fn().mockResolvedValue('protected:{"verifier":"provider-state"}'),
      readSession: vi.fn(),
      request: vi.fn(),
      saveProviderUpdated: vi.fn(),
      saveSent: vi.fn(),
    };
    const provider: PasswordRecoveryProvider = {
      begin: vi.fn(),
      exchange: vi.fn().mockResolvedValue({
        authState: { session: "rotated-recovery-state" },
        email: "learner@example.com",
        userId: "auth-user-a",
      }),
      updatePassword: vi.fn(),
    };
    const recovery = createPasswordRecoveryModule({
      apiOrigin: "https://api.huayi.example",
      protectTransientAuthState: (value) => `protected:${value}`,
      provider,
      repository,
      unprotectTransientAuthState: (value) => value.replace(/^protected:/u, ""),
    });

    await expect(recovery.callback({ code: "provider-code", flowId: "flow-a" })).resolves.toEqual({
      csrfToken: "c".repeat(32),
      expiresAt: new Date("2026-08-14T10:15:00.000Z"),
      recoverySessionId: "recovery-session",
    });
    expect(provider.exchange).toHaveBeenCalledWith({
      authState: { verifier: "provider-state" },
      code: "provider-code",
    });
    expect(repository.callback).toHaveBeenCalledWith(
      "flow-a",
      "auth-user-a",
      "learner@example.com",
      'protected:{"session":"rotated-recovery-state"}',
    );
  });

  it("resumes provider-updated completion without changing the password twice", async () => {
    const repository = {
      callback: vi.fn(),
      claimCompletion: vi
        .fn()
        .mockResolvedValueOnce({
          flowId: "flow-a",
          leaseId: "lease-a",
          protectedProviderState: 'protected:{"session":"recovery-state"}',
          stage: "verified",
        })
        .mockResolvedValueOnce({ flowId: "flow-a", leaseId: "lease-b", stage: "provider-updated" }),
      claimDispatch: vi.fn(),
      complete: vi.fn().mockResolvedValue(undefined),
      failDispatch: vi.fn(),
      markDispatched: vi.fn(),
      readProviderState: vi.fn(),
      readSession: vi.fn(),
      request: vi.fn(),
      saveProviderUpdated: vi.fn(),
      saveSent: vi.fn(),
    };
    const provider: PasswordRecoveryProvider = {
      begin: vi.fn(),
      exchange: vi.fn(),
      updatePassword: vi.fn().mockResolvedValue({
        authState: { session: "rotated-state" },
        userId: "auth-user-a",
      }),
    };
    const recovery = createPasswordRecoveryModule({
      apiOrigin: "https://api.huayi.example",
      protectTransientAuthState: (value) => `protected:${value}`,
      provider,
      repository,
      unprotectTransientAuthState: (value) => value.replace(/^protected:/u, ""),
    });
    const command = {
      csrfToken: "c".repeat(32),
      origin: "https://app.huayi.example",
      password: "correct horse battery staple",
      recoverySessionId: "recovery-session",
    };

    await recovery.complete(command);
    await recovery.complete(command);
    expect(provider.updatePassword).toHaveBeenCalledOnce();
    expect(repository.saveProviderUpdated).toHaveBeenCalledWith(
      "flow-a",
      "lease-a",
      "auth-user-a",
      'protected:{"session":"rotated-state"}',
    );
    expect(repository.complete).toHaveBeenNthCalledWith(1, "flow-a", "lease-a");
    expect(repository.complete).toHaveBeenNthCalledWith(2, "flow-a", "lease-b");
  });
});
