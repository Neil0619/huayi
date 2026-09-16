import { afterEach, expect, it, vi } from "vitest";
import {
  createBackfillState,
  discoverBackfill,
  backfillStatus,
  discardBackfillSource,
} from "@huayi/store-domain";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage, backfillStorageSchema } from "./backfill-vault.js";
import { BackfillCloudError } from "./backfill-cloud-api.js";
import { BackfillReviewPanel } from "../content/shanbay/backfill-review-panel.js";

let panel: BackfillReviewPanel | undefined;
afterEach(() => {
  panel?.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});
async function setup() {
  const remote = createBackfillState();
  discoverBackfill(remote, ["franky", "msg"], "local", new Date().toISOString());
  for (const source of Object.values(remote.sources)) source.state = "unresolved";
  let revision = 1;
  let token = "fixture-session";
  let lock: Promise<unknown> = Promise.resolve();
  const status = () => ({
    ...backfillStatus(remote),
    scopeId: "account",
    enabled: true,
    dailyHour: 8,
    revision,
    lastCheckedAt: null,
  });
  const calls: string[] = [];
  const network = async (label: string) => {
    calls.push(label);
    await new Promise((resolve) => setTimeout(resolve, 30));
  };
  let saved = initialBackfillStorage();
  const authority = createBackfillAuthority({
    vault: {
      read: async () => backfillStorageSchema.parse(saved),
      write: async (value) => {
        saved = backfillStorageSchema.parse(value);
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
          updatedAt: "2026-09-16T00:00:00Z",
        },
      }),
    },
    lock: (work) => {
      const current = lock.then(work);
      lock = current.catch(() => undefined);
      return current;
    },
    api: {
      status: async () => {
        await network("GET status");
        return status();
      },
      unresolved: async () => {
        await network("GET unresolved");
        return {
          items: Object.values(remote.sources).filter((source) => source.state === "unresolved"),
          unknownBatches: [],
          revision,
          nextCursor: null,
        };
      },
      command: async (_token, _key, command) => {
        await network(`POST ${command.action}`);
        if ("expectedRevision" in command && command.expectedRevision !== revision)
          throw new BackfillCloudError(true, "request-failed");
        const accepted =
          command.action === "discard" &&
          discardBackfillSource(remote, command.source, new Date().toISOString());
        revision += 1;
        return { accepted, status: status(), batch: null, nextCursor: null };
      },
    },
  });
  const prepare = authority.run(async (context) => {
    const scope = context.state.scopes[context.scope];
    if (!scope) throw new Error("Missing account");
    scope.adopted = true;
    context.state.page = { scope: context.scope, tabId: 1, documentId: "doc", batch: null };
  });
  await prepare;
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    allowPage: async () => true,
    grantConsent: async () => undefined,
    openTab: async () => 1,
    activateTab: async () => undefined,
    setBadge: async () => undefined,
    scheduleMore: () => undefined,
    discovery: {
      lexicon: { snapshot: async () => [] },
      eudic: { listWords: async () => [] },
      allowEudic: async () => false,
    },
  });
  panel = new BackfillReviewPanel({
    document,
    acceptsUserGesture: () => true,
    continueBackfill: async () => undefined,
    sendMessage: (message) =>
      runtime.handle(message, {
        id: "extension",
        url: "https://web.shanbay.com/wordsweb/#/collection",
        frameId: 0,
        tab: { id: 1 },
        documentId: "doc",
      }),
  });
  await panel.open();
  const root = document.querySelector("[data-huayi-backfill]")?.shadowRoot;
  if (!root) throw new Error("Missing panel");
  const skip = [...root.querySelectorAll("button")].find((button) => button.textContent === "跳过");
  if (!skip) throw new Error("Missing skip");
  calls.length = 0;
  return {
    root,
    skip,
    calls,
    remote,
    saved: () => saved,
    changeIdentity: () => {
      token = "new-session";
    },
    changeRevision: () => {
      revision += 1;
    },
  };
}

it("skipping a cloud word keeps other inputs usable and needs only one cloud round trip", async () => {
  const { root, skip, calls, remote } = await setup();
  skip.click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const other = root.querySelector<HTMLInputElement>('[aria-label="msg 的回填目标"]');
  // Soft assertion also records the independent request-chain measurement on the failing baseline.
  expect.soft(other?.disabled).toBe(false);
  await vi.waitFor(() => expect(remote.sources.franky?.state).toBe("discarded"));
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLInputElement>('[aria-label="msg 的回填目标"]')?.disabled).toBe(
      false,
    ),
  );
  expect(calls).toEqual(["POST discard"]);
});

it("retains the other alias for a second cloud skip with no status or list refetch", async () => {
  const { root, calls, remote } = await setup();
  for (const source of ["franky", "msg"]) {
    const row = root.querySelector(`[aria-label="${source} 的回填目标"]`)?.closest(".row");
    const skip = [...(row?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "跳过",
    );
    if (!skip) throw new Error("Missing skip");
    skip.click();
    await vi.waitFor(() =>
      expect(root.querySelector(`[aria-label="${source} 的回填目标"]`)).toBeNull(),
    );
    expect(remote.sources[source]?.state).toBe("discarded");
  }
  expect(calls).toEqual(["POST discard", "POST discard"]);
  expect(root.textContent).toContain("需处理 0");
});
it("cached mutation still rejects a server revision change, retaining the draft", async () => {
  const { root, skip, calls, remote, saved, changeRevision } = await setup();
  changeRevision();
  skip.click();
  await vi.waitFor(() =>
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("未确认"),
  );
  expect(root.querySelector("input")).not.toBeNull();
  expect(remote.sources.franky?.state).toBe("unresolved");
  expect(calls).toEqual(["POST discard"]);
  expect(saved().scopes.account?.pending).toBeNull();
});
it("cached mutation cannot use an old account binding after session replacement", async () => {
  const { root, skip, calls, remote, changeIdentity } = await setup();
  changeIdentity();
  skip.click();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).not.toBe(""));
  expect(remote.sources.franky?.state).toBe("unresolved");
  expect(calls).toEqual([]);
  expect(root.querySelector("input")).toBeNull();
});

it("clears old account details when the session changes during an in-flight skip", async () => {
  const { root, skip, calls, remote, saved, changeIdentity } = await setup();
  skip.click();
  await vi.waitFor(() => expect(calls).toEqual(["POST discard"]), { interval: 1 });
  changeIdentity();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).not.toBe(""));
  expect(root.querySelector("input")).toBeNull();
  expect(root.textContent).not.toContain("franky");
  expect(remote.sources.franky?.state).toBe("discarded");
  expect(saved().scopes.account?.status.revision).toBe(1);
  expect(saved().sessionBinding).toBeNull();
});
