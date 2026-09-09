import { describe, expect, it, vi } from "vitest";
import { createSessionManager } from "./session-manager";
import { deferred } from "../components/draft-test-support";
const account = { id: "00000000-0000-4000-8000-000000000001", email: null, linkedToWeb: false };
describe("memory-only WeChat session", () => {
  it("starts fresh WeChat login after clearing an in-flight login, without an old finally clearing the new request", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const code = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const manager = createSessionManager({
      code,
      remember: vi.fn(),
      remembered: () => false,
      request: async () => ({
        state: "onboarding",
        ticket: "t".repeat(43),
        bindingCode: "ABCDEF0123",
        expiresAt: "2099-09-10T00:00:00Z",
      }),
    });
    const first = manager.login();
    const firstOutcome = Promise.allSettled([first]);
    manager.clear();
    const second = manager.login();
    const secondOutcome = Promise.allSettled([second]);
    old.resolve("old-code");
    await firstOutcome;
    const third = manager.login();
    const thirdOutcome = Promise.allSettled([third]);
    fresh.resolve("new-code");
    expect(await secondOutcome).toMatchObject([{ status: "fulfilled" }]);
    expect(await thirdOutcome).toMatchObject([{ status: "fulfilled" }]);
    expect(code).toHaveBeenCalledTimes(2);
    expect(manager.getSnapshot().onboarding?.ticket).toBe("t".repeat(43));
  });
  it("renews an expired bearer once, without saving tokens or reusing a revoked login", async () => {
    let now = Date.parse("2026-09-09T00:00:00Z");
    let exchanges = 0;
    const manager = createSessionManager({
      now: () => now,
      code: async () => "fresh-code",
      remember: () => undefined,
      remembered: () => true,
      request: async (path) =>
        path.endsWith("/login")
          ? {
              state: "authenticated",
              token: String(++exchanges).repeat(43),
              expiresAt: new Date(now + 1000).toISOString(),
            }
          : account,
    });
    const first = await manager.ensure();
    now += 1001;
    const refreshed = await Promise.all([manager.ensure(), manager.ensure()]);
    expect(refreshed).toEqual(["2".repeat(43), "2".repeat(43)]);
    expect(refreshed[0]).not.toBe(first);
    expect(exchanges).toBe(2);
    manager.invalidate(first);
    expect(manager.token()).toBe(refreshed[0]);
  });
  it("shares one restart exchange and remembers only a login preference", async () => {
    const code = vi.fn(async () => "code");
    const remember = vi.fn();
    const session = createSessionManager({
      code,
      remember,
      remembered: () => true,
      request: async (path) =>
        path.endsWith("/login")
          ? { state: "authenticated", token: "x".repeat(43), expiresAt: "2026-09-10T00:00:00Z" }
          : account,
    });
    expect(await Promise.all([session.ensure(), session.ensure()])).toEqual([
      "x".repeat(43),
      "x".repeat(43),
    ]);
    expect(code).toHaveBeenCalledOnce();
    expect(remember).toHaveBeenCalledWith(true);
    expect(JSON.stringify(session.getSnapshot())).not.toContain("x".repeat(43));
    session.clear();
    expect(session.token()).toBeUndefined();
    expect(remember).toHaveBeenLastCalledWith(false);
  });
  it("never auto-opens an unregistered identity and rejects late login after logout", async () => {
    const remember = vi.fn();
    let resolveCode: (code: string) => void = () => undefined;
    const session = createSessionManager({
      code: () =>
        new Promise((resolve) => {
          resolveCode = resolve;
        }),
      remember,
      remembered: () => false,
      request: async () => ({
        state: "onboarding",
        ticket: "t".repeat(43),
        bindingCode: "012345ABCD",
        expiresAt: "2026-09-10T00:00:00Z",
      }),
    });
    const pending = session.login();
    session.clear();
    resolveCode("code");
    await expect(pending).rejects.toThrow();
    expect(session.getSnapshot().onboarding).toBeNull();
  });
});
