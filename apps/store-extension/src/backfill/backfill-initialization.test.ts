import { expect, it, vi } from "vitest";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage } from "./backfill-vault.js";
import { BackfillError } from "./backfill-errors.js";

it("retries failed initialization only through an explicit trusted request and durable alarm", async () => {
  let saved = initialBackfillStorage();
  const status = vi.fn(async () => ({
    scopeId: "account",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 496,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  }));
  status.mockRejectedValueOnce(new BackfillError("connection"));
  const authority = createBackfillAuthority({
    vault: {
      read: async () => structuredClone(saved),
      write: async (value) => {
        saved = structuredClone(value);
      },
    },
    session: {
      readSession: async () => ({
        token: "private-test-token",
        expiresAt: "2099-01-01T00:00:00Z",
        preferences: {
          cloudWordCopyMode: "disabled",
          extensionQueryModelMode: "platform",
          studyCaptureMode: "manual",
          revision: 1,
          updatedAt: "2026-09-15T00:00:00Z",
        },
      }),
    },
    api: { status, command: vi.fn(), unresolved: vi.fn() },
    lock: async (operation) => operation(),
  });
  const scheduleMore = vi.fn(async () => undefined);
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords: async () => [] },
      allowEudic: async () => false,
    },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 7,
    activateTab: async () => undefined,
    setBadge: async () => undefined,
    scheduleMore,
  });
  const sender = { id: "extension", url: "chrome-extension://extension/popup.html" };
  await runtime.refresh();
  expect(await runtime.handle({ type: "store/backfill-status" }, sender)).toMatchObject({
    initializing: true,
    status: { pendingCount: 0 },
    checkError: "无法连接回填服务，请检查网络后重试。",
  });
  expect(status).toHaveBeenCalledOnce();
  expect(
    await runtime.handle(
      { type: "store/backfill-initialize" },
      { ...sender, url: "https://untrusted.test" },
    ),
  ).toBeUndefined();
  expect(status).toHaveBeenCalledOnce();
  await runtime.handle({ type: "store/backfill-initialize" }, sender);
  await runtime.refresh();
  expect(scheduleMore).toHaveBeenCalled();
  expect(await runtime.handle({ type: "store/backfill-status" }, sender)).toMatchObject({
    initializing: false,
    status: { scopeId: "account", pendingCount: 496 },
  });
});
