import { describe, expect, it, vi } from "vitest";
import { createBackfillAuthority } from "./backfill-authority.js";
import { BackfillCloudError } from "./backfill-cloud-api.js";
import { initialBackfillStorage } from "./backfill-vault.js";
import type { ShanbayBackfillResponse, ShanbayBackfillCommand } from "@huayi/cloud-contracts";
import {
  discoverBackfill,
  claimBackfillBatch,
  confirmBackfillTargets,
  createBackfillState,
} from "@huayi/store-domain";
import { adoptBackfill } from "@huayi/cloud-contracts";

const remote = (scopeId = "account-a") => ({
  scopeId,
  enabled: true,
  dailyHour: 8,
  revision: 1,
  pendingCount: 0,
  unresolvedCount: 0,
  unknownCount: 0,
  lastCheckedAt: null,
});
const response = (scopeId = "account-a"): ShanbayBackfillResponse => ({
  status: remote(scopeId),
  accepted: true,
  batch: null,
  nextCursor: null,
});
function harness() {
  let saved = initialBackfillStorage();
  let token = "a".repeat(43);
  const command = vi.fn<
    (
      token: string,
      key: string,
      command: ShanbayBackfillCommand,
    ) => Promise<ShanbayBackfillResponse>
  >(async () => response(token.startsWith("a") ? "account-a" : "account-b"));
  const status = vi.fn(async () => remote(token.startsWith("a") ? "account-a" : "account-b"));
  const authority = createBackfillAuthority({
    vault: {
      read: async () => structuredClone(saved),
      write: async (state) => {
        saved = structuredClone(state);
      },
    },
    session: {
      readSession: async () => ({
        token,
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
    api: {
      status,
      command,
      unresolved: async () => ({ items: [], unknownBatches: [], revision: 1, nextCursor: null }),
    },
    lock: async (operation) => operation(),
  });
  return {
    authority,
    command,
    status,
    saved: () => saved,
    switchAccount: () => {
      token = "b".repeat(43);
    },
  };
}
describe("Backfill account authority", () => {
  it("rejects an account switch while the initial status request is in flight", async () => {
    const h = harness();
    h.status.mockImplementationOnce(async () => {
      h.switchAccount();
      return remote("account-a");
    });
    const operation = vi.fn(async () => undefined);
    await expect(h.authority.run(operation)).rejects.toMatchObject({ code: "authentication" });
    expect(operation).not.toHaveBeenCalled();
  });
  it("publishes every confirmation before sources can be claimed by another device during adoption", async () => {
    const h = harness();
    const words = Array.from(
      { length: 101 },
      (_, index) =>
        `word${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`,
    );
    await h.authority.run(async (context) => {
      discoverBackfill(context.state.local, [...words].reverse(), "local", "2026-09-15T00:00:00Z");
      confirmBackfillTargets(context.state.local, words, "2026-09-15T00:00:00Z");
      await context.persist();
    });
    const remoteState = createBackfillState();
    const claimed: string[] = [];
    h.command.mockImplementation(async (_token, _key, command) => {
      if (command.action !== "adopt") throw new Error("Expected adoption.");
      adoptBackfill(remoteState, command.sources, command.confirmed, "2026-09-15T00:00:00Z");
      const batch = claimBackfillBatch(remoteState, {
        holder: "other-device",
        token: crypto.randomUUID(),
        now: "2026-09-15T00:00:00Z",
      });
      if (batch) claimed.push(...batch.headwords);
      return response();
    });
    await h.authority.run((context) => context.adopt());
    expect(claimed).toEqual([]);
    expect(Object.keys(remoteState.sources)).toHaveLength(101);
    expect(h.saved().scopes["account-a"]?.adopted).toBe(true);
  });
  it("retains uncertain writes and retries their exact key before progressing", async () => {
    const h = harness();
    h.command.mockRejectedValueOnce(new Error("lost response"));
    await expect(
      h.authority.run((context) => context.command({ action: "claim" })),
    ).rejects.toThrow();
    const key = h.saved().scopes["account-a"]?.pending?.key;
    await h.authority.run((context) => context.command({ action: "claim" }));
    expect(h.command.mock.calls.map((call) => call[1])).toEqual([key, key]);
    expect(h.saved().scopes["account-a"]?.pending).toBeNull();
  });
  it("releases a definite revision rejection so a corrected request can proceed", async () => {
    const h = harness();
    h.command.mockRejectedValueOnce(new BackfillCloudError(true, "request-failed"));
    await expect(
      h.authority.run((context) =>
        context.command({ action: "settings", enabled: true, dailyHour: 8, expectedRevision: 0 }),
      ),
    ).rejects.toThrow();
    expect(h.saved().scopes["account-a"]?.pending).toBeNull();
    await h.authority.run((context) =>
      context.command({ action: "settings", enabled: true, dailyHour: 8, expectedRevision: 1 }),
    );
    expect(h.command).toHaveBeenCalledTimes(2);
    expect(h.command.mock.calls[1]?.[2]).toMatchObject({ expectedRevision: 1 });
  });
  it("does not flush a previous account's pending headwords after switching accounts", async () => {
    const h = harness();
    h.command.mockRejectedValueOnce(new Error("offline"));
    await expect(
      h.authority.run((context) =>
        context.command({ action: "discover", origin: "local", headwords: ["private"] }),
      ),
    ).rejects.toThrow();
    h.switchAccount();
    await h.authority.run((context) =>
      context.command({ action: "discover", origin: "local", headwords: ["public"] }),
    );
    expect(h.command.mock.calls[1]?.[0]).toBe("b".repeat(43));
    expect(h.command.mock.calls[1]?.[2]).toMatchObject({ headwords: ["public"] });
    expect(h.saved().scopes["account-a"]?.pending?.command).toMatchObject({
      headwords: ["private"],
    });
  });
  it("rejects a connection failure without claiming from the standalone ledger", async () => {
    const h = harness();
    h.status.mockRejectedValueOnce(new Error("offline"));
    const work = vi.fn(async () => undefined);
    await expect(h.authority.run(work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(h.command).not.toHaveBeenCalled();
    expect(h.saved().local.batches).toEqual([]);
  });
  it("pauses standalone claims before an interrupted adoption and resumes the same write", async () => {
    const h = harness();
    await h.authority.run(async (context) => {
      discoverBackfill(context.state.local, ["apple"], "local", "2026-09-15T00:00:00Z");
      claimBackfillBatch(context.state.local, {
        holder: "local",
        token: "pending-local",
        now: "2026-09-15T00:00:00Z",
      });
      await context.persist();
    });
    h.command.mockRejectedValueOnce(new Error("response lost"));
    await expect(h.authority.run((context) => context.adopt())).rejects.toThrow();
    expect(h.saved().migratedTo).toBe("account-a");
    expect(h.saved().scopes["account-a"]?.adopted).toBe(false);
    const pending = h.saved().scopes["account-a"]?.pending;
    expect(pending?.command).toMatchObject({ action: "adopt", unknown: ["apple"] });
    await h.authority.run((context) => context.adopt());
    expect(h.saved().scopes["account-a"]?.adopted).toBe(true);
    expect(h.command.mock.calls[1]?.[1]).toBe(pending?.key);
  });
});

it("uploads durable dismissal evidence before sources and resumes a lost response with the same key", async () => {
  const h = harness();
  const { discardAllBackfillReview, adoptBackfillDismissed } =
    await import("@huayi/cloud-contracts");
  const words = Array.from(
    { length: 101 },
    (_, i) => `word${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}`,
  );
  const now = "2026-09-15T00:00:00Z";
  await h.authority.run(async (context) => {
    discoverBackfill(context.state.local, words, "local", now);
    for (let index = 0; index < words.length; index += 100)
      context.state.local.batches.push({
        token: `local-${index}`,
        holder: "local",
        headwords: words.slice(index, index + 100),
        state: "unknown",
        expiresAt: now,
      });
    discardAllBackfillReview(context.state.local, now);
    await context.persist();
  });
  const remoteState = createBackfillState();
  const claimed: string[] = [];
  let loseResponse = true;
  h.command.mockImplementation(async (_token, _key, command) => {
    if (command.action !== "adopt") throw new Error("Expected adoption.");
    adoptBackfillDismissed(remoteState, command.dismissed ?? [], {
      holder: "server",
      token: () => crypto.randomUUID(),
      now,
    });
    adoptBackfill(remoteState, command.sources, command.confirmed, now);
    const claim = claimBackfillBatch(remoteState, {
      holder: "other",
      token: crypto.randomUUID(),
      now,
    });
    if (claim) claimed.push(...claim.headwords);
    if (loseResponse) {
      loseResponse = false;
      throw new Error("lost evidence response");
    }
    return response();
  });
  await expect(h.authority.run((context) => context.adopt())).rejects.toThrow(
    "lost evidence response",
  );
  expect(remoteState.batches.flatMap((batch) => batch.headwords)).toHaveLength(100);
  expect(remoteState.sources).toEqual({});
  const pendingKey = h.saved().scopes["account-a"]?.pending?.key;
  await h.authority.run((context) => context.adopt());
  expect(h.command.mock.calls[1]?.[1]).toBe(pendingKey);
  expect(claimed).toEqual([]);
  expect(remoteState.batches.flatMap((batch) => batch.headwords)).toHaveLength(101);
  expect(Object.values(remoteState.sources).every((source) => source.state === "discarded")).toBe(
    true,
  );
  expect(h.saved().scopes["account-a"]?.adopted).toBe(true);
});

it("supports local unknown-only review commands with revision fencing, reload persistence and no confirmation", async () => {
  let saved = initialBackfillStorage();
  saved.localEnabled = true;
  const now = "2026-09-15T00:00:00Z";
  const words = Array.from(
    { length: 40 },
    (_, i) => `word${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}`,
  );
  discoverBackfill(saved.local, words, "local", now);
  for (let index = 0; index < words.length; index += 20)
    saved.local.batches.push({
      token: `batch-${index}`,
      holder: "local",
      headwords: words.slice(index, index + 20),
      state: "unknown",
      expiresAt: now,
    });
  const authority = createBackfillAuthority({
    vault: {
      read: async () => structuredClone(saved),
      write: async (state) => {
        saved = structuredClone(state);
      },
    },
    session: { readSession: async () => null },
    api: null,
    lock: async (operation) => operation(),
  });
  await expect(
    authority.run((context) => context.command({ action: "discard-review", expectedRevision: 99 })),
  ).rejects.toThrow("回填状态已变化");
  expect(saved.local.batches.every((batch) => batch.dismissedAt === undefined)).toBe(true);
  await authority.run((context) =>
    context.command({ action: "discard-unknown", token: "batch-0", expectedRevision: 0 }),
  );
  expect(await authority.run((context) => context.unresolved())).toMatchObject({
    items: [],
    unknownBatches: [{ token: "batch-20", headwords: words.slice(20) }],
  });
  await authority.run((context) =>
    context.command({ action: "discard-review", expectedRevision: 1 }),
  );
  expect(await authority.run((context) => context.unresolved())).toMatchObject({
    items: [],
    unknownBatches: [],
  });
  expect(
    await authority.run((context) =>
      context.command({ action: "retry-unknown", token: "batch-0" }),
    ),
  ).toMatchObject({ accepted: false });
  await authority.run((context) =>
    context.command({ action: "discover", origin: "eudic", headwords: words }),
  );
  expect(await authority.run((context) => context.command({ action: "claim" }))).toMatchObject({
    batch: null,
  });
  expect(Object.values(saved.local.targets).every((target) => target.confirmedAt === null)).toBe(
    true,
  );
});
