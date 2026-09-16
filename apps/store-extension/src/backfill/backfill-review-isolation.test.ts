import { expect, it, vi } from "vitest";
import type { ShanbayBackfillUnresolved } from "@huayi/cloud-contracts";
import { createBackfillAuthority } from "./backfill-authority.js";
import { handleBackfillPage } from "./backfill-page-handler.js";
import { backfillPageReviewResponseSchema, backfillMessageSchema } from "./backfill-messages.js";
import {
  backfillStorageSchema,
  createBackfillVault,
  initialBackfillStorage,
} from "./backfill-vault.js";

const sender = { tab: { id: 1 }, documentId: "document-a" };
const source = {
  headword: "ran",
  target: "run",
  origins: ["local" as const],
  attempt: "lemma" as const,
  state: "unresolved" as const,
  updatedAt: "2026-09-16T00:00:00Z",
};
function cloudHarness() {
  let token = "private-session-token-a";
  let scopeId = "private-account-a";
  let revision = 7;
  let saved = initialBackfillStorage();
  const currentStatus = () => ({
    scopeId,
    enabled: true,
    dailyHour: 8,
    revision,
    pendingCount: 0,
    unresolvedCount: 1,
    unknownCount: 1,
    lastCheckedAt: null,
  });
  const unresolved = vi.fn<() => Promise<ShanbayBackfillUnresolved>>(async () => ({
    items: [source],
    unknownBatches: [{ token: "private-cloud-batch", headwords: ["apple"] }],
    nextCursor: "private-cloud-cursor",
    revision: 7,
  }));
  const command = vi.fn(async () => ({
    status: currentStatus(),
    accepted: true,
    batch: null,
    nextCursor: null,
  }));
  const options = {
    vault: {
      read: async () => backfillStorageSchema.parse(saved),
      write: async (value: typeof saved) => {
        saved = backfillStorageSchema.parse(value);
      },
    },
    session: {
      readSession: async () => ({
        token,
        expiresAt: "2099-01-01T00:00:00Z",
        preferences: {
          cloudWordCopyMode: "disabled" as const,
          extensionQueryModelMode: "platform" as const,
          studyCaptureMode: "manual" as const,
          revision: 1,
          updatedAt: "2026-09-16T00:00:00Z",
        },
      }),
    },
    api: { status: async () => currentStatus(), unresolved, command },
    lock: async <T>(operation: () => Promise<T>) => operation(),
  };
  const authority = createBackfillAuthority(options);
  const prepare = () =>
    authority.run(async (context) => {
      const scope = context.state.scopes[context.scope];
      if (!scope) throw new Error("Missing account");
      scope.adopted = true;
      context.state.page = {
        scope: context.scope,
        tabId: 1,
        documentId: null,
        batch: null,
        reviewRequested: true,
      };
    });
  const handle = (message: unknown) =>
    authority.run((context) =>
      handleBackfillPage(context, backfillMessageSchema.parse(message), sender),
    );
  return {
    prepare,
    handle,
    options,
    unresolved,
    command,
    saved: () => saved,
    setRevision: (value: number) => {
      revision = value;
    },
    changeIdentity: (sameAccount = false) => {
      token = "private-session-token-b";
      if (!sameAccount) scopeId = "private-account-b";
    },
  };
}

it("persists only encrypted authority mappings and restores them after worker restart", async () => {
  const h = cloudHarness();
  await h.prepare();
  const review = backfillPageReviewResponseSchema.parse(
    await h.handle({ type: "store/backfill-page-review" }),
  );
  expect(JSON.stringify(review)).not.toMatch(/private-|revision|origins|attempt|scope/);
  let raw: unknown;
  const storage = {
    read: async () => raw,
    write: async (_key: string, value: unknown) => {
      raw = value;
    },
    delete: async () => undefined,
  };
  const device = { getDek: async () => new Uint8Array(32).fill(17) };
  const vault = createBackfillVault(device, storage);
  await vault.write(h.saved());
  // Random base64 can incidentally spell a short word; verify the envelope and key boundary.
  expect(raw).toEqual({ version: 1, iv: expect.any(String), ciphertext: expect.any(String) });
  await expect(
    createBackfillVault({ getDek: async () => new Uint8Array(32).fill(18) }, storage).read(),
  ).rejects.toThrow();
  const restored = await createBackfillVault(device, storage).read();
  expect(restored.page?.review).toEqual(h.saved().page?.review);
  const restarted = createBackfillAuthority({ ...h.options, vault });
  const result = await restarted.run((context) =>
    handleBackfillPage(
      context,
      {
        type: "store/backfill-page-review-retry-unknown",
        batchAlias: review.unknownBatches[0]?.alias ?? "",
      },
      sender,
    ),
  );
  expect(result).toEqual({
    accepted: true,
    update: 1,
    pendingCount: 0,
    unresolvedCount: 1,
    unknownCount: 1,
  });
  expect(h.command).toHaveBeenCalledWith("private-session-token-a", expect.any(String), {
    action: "retry-unknown",
    token: "private-cloud-batch",
  });
  expect((await vault.read()).page?.review?.unknownBatches).toEqual([]);
  expect((await vault.read()).page?.review?.sources).toHaveLength(1);
});

it.each([true, false])(
  "rejects saved aliases after a session change, same account=%s",
  async (sameAccount) => {
    const h = cloudHarness();
    await h.prepare();
    const first = backfillPageReviewResponseSchema.parse(
      await h.handle({ type: "store/backfill-page-review" }),
    );
    h.changeIdentity(sameAccount);
    expect(
      await h.handle({
        type: "store/backfill-page-review-discard",
        sourceAlias: first.items[0]?.alias,
      }),
    ).not.toMatchObject({ accepted: true });
    expect(
      await h.handle({ type: "store/backfill-page-review", cursorAlias: first.nextCursorAlias }),
    ).not.toMatchObject({ accepted: true });
    expect(h.command).not.toHaveBeenCalled();
  },
);

it("rejects account changes during an unresolved read before returning aliases", async () => {
  const h = cloudHarness();
  await h.prepare();
  h.unresolved.mockImplementationOnce(async () => {
    h.changeIdentity();
    return { items: [source], unknownBatches: [], nextCursor: null, revision: 7 };
  });
  await expect(h.handle({ type: "store/backfill-page-review" })).rejects.toMatchObject({
    code: "authentication",
  });
  expect(h.saved().page?.review).toBeNull();
  expect(h.command).not.toHaveBeenCalled();
});

it("rejects pagination after remote revision changes instead of mixing snapshots", async () => {
  const h = cloudHarness();
  await h.prepare();
  const first = backfillPageReviewResponseSchema.parse(
    await h.handle({ type: "store/backfill-page-review" }),
  );
  h.unresolved.mockResolvedValueOnce({
    items: [],
    unknownBatches: [],
    nextCursor: null,
    revision: 8,
  });
  expect(
    await h.handle({ type: "store/backfill-page-review", cursorAlias: first.nextCursorAlias }),
  ).toEqual({ accepted: false, batch: null, reason: "stale" });
  expect(h.saved().page?.review).toBeNull();
  h.setRevision(8);
  h.unresolved.mockResolvedValueOnce({
    items: [source],
    unknownBatches: [],
    nextCursor: null,
    revision: 8,
  });
  const refreshed = backfillPageReviewResponseSchema.parse(
    await h.handle({ type: "store/backfill-page-review" }),
  );
  expect(refreshed.items).toHaveLength(1);
});

it("reads the existing vault page shape without losing its batch or enabling review", () => {
  const previous = initialBackfillStorage();
  previous.page = {
    scope: "local",
    tabId: 1,
    documentId: "document-a",
    batch: {
      alias: crypto.randomUUID(),
      token: "old-private-batch",
      items: [{ alias: crypto.randomUUID(), headword: "apple" }],
    },
  };
  const restored = backfillStorageSchema.parse(JSON.parse(JSON.stringify(previous)));
  expect(restored.page?.batch).toEqual(previous.page.batch);
  expect(restored.page?.reviewRequested ?? false).toBe(false);
  expect(restored.page?.review ?? null).toBeNull();
});

it.each([
  { type: "store/backfill-page-review", cursorAlias: "private-cloud-cursor" },
  { type: "store/backfill-page-review", cursor: "private-cloud-cursor" },
  { type: "store/backfill-page-review", expectedScope: "private-account-a" },
  { type: "store/backfill-page-review-discard-all", revision: 7 },
  { type: "store/backfill-page-review-discard", sourceAlias: crypto.randomUUID(), revision: 7 },
  {
    type: "store/backfill-page-review-retry-unknown",
    batchAlias: crypto.randomUUID(),
    token: "private-cloud-batch",
  },
  {
    type: "store/backfill-page-review-discard-unknown",
    batchAlias: crypto.randomUUID(),
    token: "private-cloud-batch",
  },
  {
    type: "store/backfill-page-review-replace",
    sourceAlias: crypto.randomUUID(),
    target: "<script>",
  },
])("strictly rejects raw authority fields or malformed alias input: %j", (message) => {
  expect(backfillMessageSchema.safeParse(message).success).toBe(false);
});

it.each(["discard-all", "discard-unknown"] as const)(
  "sends %s as one fenced command with private server fields only inside the worker",
  async (action) => {
    const h = cloudHarness();
    await h.prepare();
    const view = backfillPageReviewResponseSchema.parse(
      await h.handle({ type: "store/backfill-page-review" }),
    );
    const message =
      action === "discard-all"
        ? { type: "store/backfill-page-review-discard-all" }
        : {
            type: "store/backfill-page-review-discard-unknown",
            batchAlias: view.unknownBatches[0]?.alias,
          };
    expect(JSON.stringify(message)).not.toMatch(/private-|revision|scope/);
    expect(await h.handle(message)).toMatchObject({ accepted: true });
    expect(h.command).toHaveBeenCalledTimes(1);
    expect(h.command).toHaveBeenCalledWith("private-session-token-a", expect.any(String), {
      action: action === "discard-all" ? "discard-review" : "discard-unknown",
      expectedRevision: 7,
      ...(action === "discard-unknown" ? { token: "private-cloud-batch" } : {}),
    });
  },
);

it("identifies same-account stale mappings without treating old identities as stale", async () => {
  const h = cloudHarness();
  await h.prepare();
  const first = backfillPageReviewResponseSchema.parse(
    await h.handle({ type: "store/backfill-page-review" }),
  );
  const discard = {
    type: "store/backfill-page-review-discard",
    sourceAlias: first.items[0]?.alias,
  };
  h.setRevision(8);
  expect(await h.handle(discard)).toEqual({ accepted: false, batch: null, reason: "stale" });
  h.changeIdentity(true);
  expect(await h.handle(discard)).toEqual({ accepted: false, batch: null });
  expect(h.command).not.toHaveBeenCalled();
});

it("identifies rotated and unknown aliases as stale only within a bound identity", async () => {
  const h = cloudHarness();
  await h.prepare();
  const first = backfillPageReviewResponseSchema.parse(
    await h.handle({ type: "store/backfill-page-review" }),
  );
  await h.handle({ type: "store/backfill-page-review" });
  for (const message of [
    { type: "store/backfill-page-review-discard", sourceAlias: first.items[0]?.alias },
    { type: "store/backfill-page-review-replace", sourceAlias: crypto.randomUUID(), target: "run" },
    {
      type: "store/backfill-page-review-retry-unknown",
      batchAlias: first.unknownBatches[0]?.alias,
    },
    { type: "store/backfill-page-review", cursorAlias: first.nextCursorAlias },
  ]) {
    expect(await h.handle(message)).toEqual({ accepted: false, batch: null, reason: "stale" });
  }
  h.changeIdentity(true);
  expect(
    await h.handle({ type: "store/backfill-page-review", cursorAlias: first.nextCursorAlias }),
  ).toEqual({ accepted: false, batch: null });
  expect(h.command).not.toHaveBeenCalled();
});
