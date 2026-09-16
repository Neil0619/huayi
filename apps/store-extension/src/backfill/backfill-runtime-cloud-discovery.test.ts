import { expect, it, vi } from "vitest";
import type { ShanbayBackfillCommand } from "@huayi/cloud-contracts";
import { StoreEudicClient } from "../wordbook/eudic-client.js";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillCloudApi } from "./backfill-cloud-api.js";
import { backfillViewSchema } from "./backfill-messages.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillProgress, initialBackfillStorage } from "./backfill-vault.js";

const privateToken = "private-cloud-token-never-display";
function harness() {
  const state = initialBackfillStorage();
  const status = {
    scopeId: "account-a",
    enabled: true,
    dailyHour: 8,
    revision: 1,
    pendingCount: 2,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  state.scopes[status.scopeId] = {
    status,
    progress: initialBackfillProgress(),
    adopted: true,
    localExcluded: [],
    adoptIndex: 0,
    adoptPhase: "evidence",
    pending: null,
  };
  let token = privateToken;
  let expiresAt = "2099-01-01T00:00:00Z";
  const commands: { key: string | null; command: ShanbayBackfillCommand }[] = [];
  const respond = vi.fn(async (_command: ShanbayBackfillCommand) => {
    void _command;
    return Response.json({ status, accepted: true, batch: null, nextCursor: null });
  });
  const cloudFetch = vi.fn<typeof fetch>(async (_url, init) => {
    void _url;
    if (init?.method !== "POST") return Response.json(status);
    const command = JSON.parse(String(init.body)) as ShanbayBackfillCommand;
    commands.push({ key: new Headers(init.headers).get("Idempotency-Key"), command });
    return respond(command);
  });
  const write = vi.fn(async () => undefined);
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write },
    session: {
      readSession: async () => ({
        token,
        expiresAt,
        preferences: {
          cloudWordCopyMode: "disabled",
          extensionQueryModelMode: "platform",
          studyCaptureMode: "manual",
          revision: 1,
          updatedAt: "2026-09-15T00:00:00Z",
        },
      }),
    },
    api: createBackfillCloudApi("https://api.example.test", "1.0.0", cloudFetch),
    lock: async (operation) => operation(),
  });
  const eudicFetch = vi.fn<typeof fetch>(async () => Response.json({ data: [], message: "ok" }));
  const openTab = vi.fn(async () => 7);
  const badge = vi.fn(async (_text: string) => {
    void _text;
  });
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: new StoreEudicClient({
        authorization: async () => "eudic-test-token",
        fetch: eudicFetch,
      }),
      allowEudic: async () => true,
    },
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab,
    activateTab: async () => undefined,
    setBadge: badge,
    scheduleMore: () => undefined,
  });
  const handle = (type: "check" | "open", expectedScope = "account-a") =>
    runtime.handle(
      {
        type: `store/backfill-${type}`,
        expectedScope,
      },
      { id: "extension", url: "chrome-extension://extension/popup.html" },
    );
  return {
    state,
    respond,
    commands,
    cloudFetch,
    eudicFetch,
    write,
    openTab,
    badge,
    handle,
    runtime,
    initialize: () => authority.run(async () => undefined),
    check: async () => {
      await handle("check");
      await runtime.refresh();
      return runtime.handle(
        { type: "store/backfill-status" },
        { id: "extension", url: "chrome-extension://extension/popup.html" },
      );
    },
    switchAccount: () => {
      token = "account-b-token";
    },
    expireSession: () => {
      expiresAt = "2020-01-01T00:00:00Z";
    },
  };
}

it.each([
  [0, "无法连接云端词库，请检查网络后重新检查。"],
  [503, "云端词库检查未完成，请稍后重试。"],
  [200, "云端词库检查未完成，请稍后重试。"],
])(
  "keeps a known cloud queue available after reconciliation failure %s and retries the exact request",
  async (status, copy) => {
    const h = harness();
    await h.initialize();
    await h.initialize();
    if (status === 0) h.respond.mockRejectedValueOnce(new TypeError(privateToken));
    else h.respond.mockResolvedValueOnce(new Response(privateToken, { status }));
    await h.runtime.refresh();
    const failed = backfillViewSchema.parse(await h.handle("open"));
    expect(failed).toMatchObject({
      status: { pendingCount: 2 },
      shared: true,
      checkError: copy,
      lastCheckedAt: null,
    });
    expect(h.openTab).toHaveBeenCalledOnce();
    expect(h.badge).toHaveBeenLastCalledWith("2");
    expect(h.eudicFetch).not.toHaveBeenCalled();
    const pending = h.state.scopes["account-a"]?.pending;
    expect(pending?.command).toEqual({ action: "reconcile", cursor: null });
    const recovered = backfillViewSchema.parse(await h.check());
    expect(recovered.checkError).toBeNull();
    expect(recovered.lastCheckedAt).not.toBeNull();
    expect(h.commands.slice(0, 2).map(({ key }) => key)).toEqual([pending?.key, pending?.key]);
    expect(h.state.scopes["account-a"]?.pending).toBeNull();
    expect(JSON.stringify(failed)).not.toContain(privateToken);
  },
);

it("does not treat a cloud authentication failure as an optional discovery failure", async () => {
  const h = harness();
  await h.initialize();
  h.respond.mockResolvedValueOnce(new Response(privateToken, { status: 401 }));
  await h.runtime.refresh();
  expect(await h.handle("open")).toMatchObject({ code: "authentication" });
  expect(h.openTab).not.toHaveBeenCalled();
  expect(h.eudicFetch).not.toHaveBeenCalled();
  expect(h.state.scopes["account-a"]?.pending).toBeNull();
});

it.each(["success", "failure"])(
  "blocks account switches during Eudic discovery %s before opening a tab",
  async (outcome) => {
    const h = harness();
    await h.initialize();
    await h.initialize();
    h.eudicFetch.mockImplementationOnce(async () => {
      h.switchAccount();
      if (outcome === "failure") throw new TypeError(privateToken);
      return Response.json({ data: [], message: "ok" });
    });
    await h.runtime.refresh();
    expect(await h.handle("open")).toMatchObject({ code: "authentication" });
    expect(h.openTab).not.toHaveBeenCalled();
    expect(h.commands.map(({ command }) => command.action)).toEqual(["reconcile"]);
  },
);

it("blocks an account session that expires during optional discovery before opening a tab", async () => {
  const h = harness();
  await h.initialize();
  h.eudicFetch.mockImplementationOnce(async () => {
    h.expireSession();
    throw new TypeError(privateToken);
  });
  await h.runtime.refresh();
  expect(await h.handle("open")).toMatchObject({ code: "authentication" });
  expect(h.openTab).not.toHaveBeenCalled();
});

it("does not turn vault persistence failure into an optional discovery error", async () => {
  const h = harness();
  await h.initialize();
  h.respond.mockImplementationOnce(async () => {
    h.write.mockRejectedValue(new Error(privateToken));
    return Response.json({
      status: h.state.scopes["account-a"]?.status,
      accepted: true,
      batch: null,
      nextCursor: null,
    });
  });
  await h.runtime.refresh();
  expect(await h.handle("open")).toMatchObject({ code: "request-failed" });
  // Navigation is safe and immediate; failed persistence never activates or claims a batch.
  expect(h.state.page).toBeNull();
  expect(h.commands.map(({ command }) => command.action)).not.toContain("claim");
});

it("retains an unknown prior claim while a discovery retry opens the existing queue", async () => {
  const h = harness();
  await h.initialize();
  const account = h.state.scopes["account-a"];
  if (!account) throw new Error("Missing account fixture.");
  account.pending = { key: crypto.randomUUID(), command: { action: "claim" } };
  const key = account.pending.key;
  h.respond.mockResolvedValueOnce(
    Response.json({
      status: account.status,
      accepted: true,
      batch: { token: "unknown-claim", headwords: ["river"], expiresAt: "2099-01-01T00:00:00Z" },
      nextCursor: null,
    }),
  );
  h.respond.mockRejectedValueOnce(new TypeError(privateToken));
  await h.runtime.refresh();
  const opened = backfillViewSchema.parse(await h.handle("open"));
  expect(opened.checkError).toContain("云端词库");
  expect(h.openTab).toHaveBeenCalledOnce();
  expect(h.commands[0]?.key).toBe(key);
  expect(h.commands.map(({ command }) => command)).toEqual([
    { action: "claim" },
    { action: "unknown", token: "unknown-claim" },
  ]);
  const unknownKey = account.pending?.key;
  expect(account.pending?.command).toEqual({ action: "unknown", token: "unknown-claim" });
  expect(backfillViewSchema.parse(await h.check()).checkError).toBeNull();
  expect(h.commands[2]).toEqual({
    key: unknownKey,
    command: { action: "unknown", token: "unknown-claim" },
  });
  expect(account.pending).toBeNull();
});
