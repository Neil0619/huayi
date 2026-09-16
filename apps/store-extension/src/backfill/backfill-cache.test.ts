import { expect, it, vi } from "vitest";
import { createBackfillAuthority } from "./backfill-authority.js";
import { initialBackfillStorage } from "./backfill-vault.js";

const remote = (scopeId = "account-a") => ({
  scopeId,
  enabled: true,
  dailyHour: 8,
  revision: 1,
  pendingCount: 496,
  unresolvedCount: 0,
  unknownCount: 0,
  lastCheckedAt: null,
});
function harness() {
  let saved = initialBackfillStorage();
  let token: string | null = "private-session-a";
  const readSession = vi.fn(async () =>
    token === null
      ? null
      : {
          token,
          expiresAt: "2099-01-01T00:00:00Z",
          preferences: {
            cloudWordCopyMode: "disabled" as const,
            extensionQueryModelMode: "platform" as const,
            studyCaptureMode: "manual" as const,
            revision: 1,
            updatedAt: "2026-09-15T00:00:00Z",
          },
        },
  );
  const status = vi.fn(async () => remote());
  let tail = Promise.resolve();
  const options = {
    vault: {
      read: async () => structuredClone(saved),
      write: async (value: typeof saved) => {
        saved = structuredClone(value);
      },
    },
    session: { readSession },
    api: { status, command: vi.fn(), unresolved: vi.fn() },
    lock: <T>(operation: () => Promise<T>) => {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  return {
    authority: createBackfillAuthority(options),
    restart: () => createBackfillAuthority(options),
    status,
    readSession,
    saved: () => saved,
    switchTo: (value: string | null) => {
      token = value;
    },
  };
}
it("reads a server-verified cached scope across worker restarts without network or raw token persistence", async () => {
  const h = harness();
  await h.authority.run(async () => undefined);
  h.status.mockRejectedValue(new Error("offline"));
  expect(await h.restart().readSnapshot()).toMatchObject({
    status: { scopeId: "account-a", pendingCount: 496 },
    initializing: false,
  });
  expect(h.status).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.saved())).not.toContain("private-session-a");
});
it("does not expose a cached account or local ledger before a new connected session is verified", async () => {
  const h = harness();
  await h.authority.run(async () => undefined);
  h.switchTo("private-session-b");
  expect(await h.authority.readSnapshot()).toMatchObject({
    initializing: true,
    shared: true,
    status: { scopeId: "initializing", pendingCount: 0, enabled: false },
  });
  expect(h.status).toHaveBeenCalledOnce();
});
it("rejects a session change during a lock-free cache read", async () => {
  const h = harness();
  await h.authority.run(async () => undefined);
  h.readSession.mockImplementationOnce(async () => {
    const previous = {
      token: "private-session-a",
      expiresAt: "2099-01-01T00:00:00Z",
      preferences: {
        cloudWordCopyMode: "disabled" as const,
        extensionQueryModelMode: "platform" as const,
        studyCaptureMode: "manual" as const,
        revision: 1,
        updatedAt: "2026-09-15T00:00:00Z",
      },
    };
    h.switchTo("private-session-b");
    return previous;
  });
  await expect(h.authority.readSnapshot()).rejects.toThrow();
});
it("returns cached counts while an authority mutation is held", async () => {
  const h = harness();
  await h.authority.run(async () => undefined);
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = vi.fn();
  const mutation = h.authority.run(async () => {
    started();
    await hold;
  });
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  try {
    expect(await h.authority.readSnapshot()).toMatchObject({ status: { pendingCount: 496 } });
  } finally {
    release();
    await mutation;
  }
});
it("retains known account counts and its refresh error through cached operations until server recovery", async () => {
  const h = harness();
  await h.authority.run(async () => undefined);
  h.status.mockRejectedValueOnce(new Error("private-network-error"));
  await expect(h.authority.run(async () => undefined)).rejects.toThrow();
  await h.authority.run(async (context) => {
    context.progress.forceRequested = true;
  }, true);
  const failed = await h.authority.readSnapshot();
  expect(failed).toMatchObject({ initializing: false, status: { pendingCount: 496 } });
  expect(failed.checkError).toBe("操作未完成，请刷新回填状态后重试。");
  expect(JSON.stringify(failed)).not.toContain("private-network-error");
  await h.authority.run(async () => undefined);
  expect((await h.authority.readSnapshot()).checkError).toBeNull();
});
it("rejects a connected server response that aliases the standalone ledger", async () => {
  const h = harness();
  h.status.mockResolvedValueOnce(remote("local"));
  const operation = vi.fn(async () => undefined);
  await expect(h.authority.run(operation)).rejects.toThrow();
  expect(operation).not.toHaveBeenCalled();
  expect(await h.authority.readSnapshot()).toMatchObject({
    initializing: true,
    shared: true,
    status: { scopeId: "initializing", pendingCount: 0 },
  });
});
