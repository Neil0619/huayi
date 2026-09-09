import { describe, expect, it, vi } from "vitest";
import { miniProgramRoutes } from "@huayi/cloud-contracts";
import { deferred } from "../components/draft-test-support";
import { createSessionManager, type SessionAdapter } from "./session-manager";

const start = {
  state: "onboarding",
  ticket: "t".repeat(43),
  bindingCode: "ABCDEF0123",
  expiresAt: "2099-09-10T00:00:00Z",
};
const result = { state: "authenticated", token: "s".repeat(43), expiresAt: start.expiresAt };
const account = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "friend@example.com",
  linkedToWeb: true,
};
const credentials = { email: account.email, password: "correct horse battery staple" };
function fixture(request: SessionAdapter["request"]) {
  const remember = vi.fn();
  return {
    remember,
    manager: createSessionManager({
      request,
      code: async () => "wx-code",
      remember,
      remembered: () => false,
    }),
  };
}

describe("direct account login and linking", () => {
  it("posts credentials once for concurrent submissions and remembers no credential or token", async () => {
    const response = deferred<unknown>();
    const request = vi.fn<SessionAdapter["request"]>(async (path) => {
      if (path === miniProgramRoutes.login) return start;
      if (path === miniProgramRoutes.loginAndLink) return response.promise;
      return account;
    });
    const { manager, remember } = fixture(request);
    await manager.login();
    const attempts = [manager.loginAndLink(credentials), manager.loginAndLink(credentials)];
    response.resolve(result);
    await Promise.all(attempts);
    expect(request.mock.calls.filter(([path]) => path === miniProgramRoutes.loginAndLink)).toEqual([
      [
        miniProgramRoutes.loginAndLink,
        { method: "POST", data: { ...credentials, ticket: start.ticket, confirmed: true } },
      ],
    ]);
    expect(manager.getSnapshot().account).toEqual(account);
    expect(remember.mock.calls).toEqual([[true]]);
    expect(JSON.stringify(manager.getSnapshot())).not.toMatch(/password|token|ticket/);
  });

  it.each(["logout", "refresh-ticket"])(
    "rejects a late linking response after %s before reading account data",
    async (change) => {
      const response = deferred<unknown>();
      let exchanges = 0;
      const request = vi.fn<SessionAdapter["request"]>(async (path) => {
        if (path === miniProgramRoutes.login)
          return { ...start, ticket: (++exchanges === 1 ? "t" : "n").repeat(43) };
        if (path === miniProgramRoutes.loginAndLink) return response.promise;
        return account;
      });
      const { manager } = fixture(request);
      await manager.login();
      const pending = manager.loginAndLink(credentials);
      const rejected = expect(pending).rejects.toThrow();
      if (change === "logout") manager.clear();
      else await manager.login();
      response.resolve(result);
      await rejected;
      expect(manager.token()).toBeUndefined();
      expect(
        request.mock.calls.filter(([path]) => path === miniProgramRoutes.account),
      ).toHaveLength(0);
    },
  );

  it("rejects a late account readback after logout and allows retry after failure", async () => {
    const readback = deferred<unknown>();
    const entered = deferred<undefined>();
    let attempts = 0;
    const { manager } = fixture(async (path) => {
      if (path === miniProgramRoutes.login) return start;
      if (path === miniProgramRoutes.loginAndLink) {
        if (++attempts === 1) throw new Error("invalid credentials");
        return result;
      }
      entered.resolve(undefined);
      return readback.promise;
    });
    await manager.login();
    await expect(manager.loginAndLink(credentials)).rejects.toThrow("invalid credentials");
    expect(manager.getSnapshot().onboarding?.ticket).toBe(start.ticket);
    const pending = manager.loginAndLink(credentials);
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
    manager.clear();
    readback.resolve(account);
    await rejected;
    expect(manager.getSnapshot().account).toBeNull();
    expect(manager.token()).toBeUndefined();
  });

  it("starts a new request after a ticket refresh while an old response is still pending", async () => {
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    let exchanges = 0;
    const request = vi.fn<SessionAdapter["request"]>(async (path, options) => {
      if (path === miniProgramRoutes.login)
        return { ...start, ticket: (++exchanges === 1 ? "t" : "n").repeat(43) };
      if (path === miniProgramRoutes.loginAndLink)
        return (options?.data as { ticket: string }).ticket === start.ticket
          ? old.promise
          : fresh.promise;
      return account;
    });
    const { manager } = fixture(request);
    await manager.login();
    const initial = manager.loginAndLink(credentials);
    const rejected = expect(initial).rejects.toThrow();
    await manager.login();
    const next = manager.loginAndLink(credentials);
    expect(
      request.mock.calls.filter(([path]) => path === miniProgramRoutes.loginAndLink),
    ).toHaveLength(2);
    old.resolve(result);
    await rejected;
    const duplicate = manager.loginAndLink(credentials);
    fresh.resolve(result);
    await Promise.all([next, duplicate]);
    expect(
      request.mock.calls.filter(([path]) => path === miniProgramRoutes.loginAndLink),
    ).toHaveLength(2);
    expect(manager.getSnapshot().account).toEqual(account);
  });

  it("does not silently coalesce a different account or independent opening into a pending login", async () => {
    const response = deferred<unknown>();
    const { manager } = fixture(async (path) =>
      path === miniProgramRoutes.login
        ? start
        : path === miniProgramRoutes.account
          ? account
          : response.promise,
    );
    await manager.login();
    const first = manager.loginAndLink(credentials);
    await expect(
      manager.loginAndLink({ ...credentials, email: "other@example.com" }),
    ).rejects.toThrow();
    await expect(manager.finish("independent")).rejects.toThrow();
    response.resolve(result);
    await first;
  });
});
