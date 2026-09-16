import { afterEach, expect, it, vi } from "vitest";
import { discoverBackfill } from "@huayi/store-domain";
import { StoreEudicClient } from "../wordbook/eudic-client.js";
import { createBackfillAuthority } from "./backfill-authority.js";
import { backfillViewSchema } from "./backfill-messages.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillStorage } from "./backfill-vault.js";

const privateToken = "private-eudic-token-never-display";
const sender = { id: "extension", url: "chrome-extension://extension/popup.html" };
const pageSender = {
  id: "extension",
  frameId: 0,
  tab: { id: 7 },
  documentId: "document",
  url: "https://web.shanbay.com/wordsweb/#/collection",
};
const entry = (context_line = "") => ({
  add_time: "2026-09-15T00:00:00Z",
  context_line,
  exp: "",
  star: 0,
  word: "apple",
});
function harness(enabled = true, queued: string[] = []) {
  const state = initialBackfillStorage();
  state.localEnabled = enabled;
  discoverBackfill(state.local, queued, "local", new Date().toISOString());
  const session = vi.fn(async () => null);
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write: async () => undefined },
    session: { readSession: session },
    api: null,
    lock: async (operation) => operation(),
  });
  const authorization = vi.fn<() => Promise<string | null>>(async () => privateToken);
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [entry()], message: "ok" }),
  );
  const snapshot = vi.fn(async () => []);
  const allowEudic = vi.fn(async () => true);
  const allowPage = vi.fn(async () => true);
  const openTab = vi.fn(async () => 7);
  const badge = vi.fn(async (_text: string) => {
    void _text;
  });
  const runtime = createBackfillRuntime({
    authority,
    runtimeId: "extension",
    discovery: {
      lexicon: { snapshot },
      eudic: new StoreEudicClient({ authorization, fetch: fetcher, timeoutMs: 20 }),
      allowEudic,
    },
    allowPage,
    grantConsent: async () => undefined,
    openTab,
    activateTab: async () => undefined,
    setBadge: badge,
    scheduleMore: () => undefined,
  });
  const handle = (type: "enable" | "check" | "open" | "status") =>
    runtime.handle(
      type === "status"
        ? { type: "store/backfill-status" }
        : {
            type: `store/backfill-${type}`,
            expectedScope: "local",
            ...(type === "enable" ? { enabled: true, shareLocal: true } : {}),
          },
      sender,
    );
  return {
    state,
    session,
    authorization,
    fetcher,
    snapshot,
    allowEudic,
    allowPage,
    openTab,
    badge,
    runtime,
    handle,
    check: async () => {
      await handle("check");
      await runtime.refresh();
      return handle("status");
    },
  };
}
afterEach(() => vi.useRealTimers());

it.each(["", " \n\t "])(
  "enables, counts and opens words from an HTTP 200 page with blank context %j",
  async (context) => {
    const h = harness(false);
    h.fetcher.mockImplementation(async () =>
      Response.json({ data: [entry(context)], message: "ok" }),
    );
    expect(await h.handle("enable")).toMatchObject({
      status: { enabled: true, pendingCount: 0 },
      checking: true,
    });
    await h.runtime.refresh();
    const enabled = backfillViewSchema.parse(await h.handle("status"));
    expect(enabled).toMatchObject({ status: { enabled: true, pendingCount: 1 }, checkError: null });
    expect(h.badge).toHaveBeenLastCalledWith("1");
    expect(backfillViewSchema.parse(await h.check()).status.pendingCount).toBe(1);
    await h.handle("open");
    expect(h.openTab).toHaveBeenCalledOnce();
    const page = await h.runtime.handle({ type: "store/backfill-page-ready" }, pageSender);
    expect(page).toMatchObject({ batch: { items: [{ headword: "apple" }] } });
  },
);

it.each(["enable", "check", "open"] as const)(
  "returns the durable queue for %s when discovery rejects a malformed HTTP response",
  async (action) => {
    const h = harness(action !== "enable", ["river"]);
    h.fetcher.mockImplementation(async () => new Response(privateToken, { status: 200 }));
    if (action === "open") await h.runtime.refresh();
    await h.handle(action);
    if (action !== "open") await h.runtime.refresh();
    const result = backfillViewSchema.parse(await h.handle("status"));
    expect(result).toMatchObject({
      status: { enabled: true, pendingCount: 1 },
      checkError: "欧路返回的数据格式异常，请稍后重新检查。",
    });
    expect(h.badge).toHaveBeenLastCalledWith("1");
    expect(h.state.localProgress).toMatchObject({
      eudicPage: 0,
      eudicCompletedAt: null,
      lastCheckedAt: null,
    });
    expect(JSON.stringify(result)).not.toContain(privateToken);
    if (action === "open") {
      expect(h.openTab).toHaveBeenCalledOnce();
      expect(
        await h.runtime.handle({ type: "store/backfill-page-ready" }, pageSender),
      ).toMatchObject({ batch: { items: [{ headword: "river" }] } });
    }
  },
);

it.each([
  [401, "欧路授权已失效，请在设置中重新配置欧路授权。"],
  [429, "欧路请求受限，请稍后重新检查。"],
  [503, "无法连接欧路，请检查网络后重试。"],
  [200, "欧路返回的数据格式异常，请稍后重新检查。"],
])(
  "keeps source-specific safe copy and retries the failed page after HTTP %s",
  async (status, copy) => {
    const h = harness();
    h.state.localProgress.eudicPage = 2;
    h.fetcher.mockResolvedValueOnce(new Response(privateToken, { status }));
    const failed = backfillViewSchema.parse(await h.check());
    expect(failed.checkError).toBe(copy);
    expect(failed.lastCheckedAt).toBeNull();
    expect(h.badge).toHaveBeenLastCalledWith("!");
    expect(h.state.localProgress.eudicPage).toBe(2);
    const recovered = backfillViewSchema.parse(await h.check());
    expect(recovered).toMatchObject({ status: { pendingCount: 1 }, checkError: null });
    expect(recovered.lastCheckedAt).not.toBeNull();
    expect(h.state.localProgress.eudicPage).toBeNull();
    expect(
      h.fetcher.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("page")),
    ).toEqual(["2", "2"]);
    expect(h.badge).toHaveBeenLastCalledWith("1");
  },
);

it("distinguishes missing, unreadable and stalled credentials and network failures without leaking secrets", async () => {
  const h = harness();
  h.authorization.mockResolvedValueOnce(null);
  expect(backfillViewSchema.parse(await h.check()).checkError).toBe(
    "尚未配置欧路授权，请在设置中填写欧路授权后重试。",
  );
  h.authorization.mockRejectedValueOnce({ code: "invalid-persisted-data", message: privateToken });
  expect(backfillViewSchema.parse(await h.check()).checkError).toBe(
    "无法读取已保存的欧路授权，请在设置中重新配置。",
  );
  h.authorization.mockImplementationOnce(() => new Promise(() => undefined));
  expect(backfillViewSchema.parse(await h.check()).checkError).toBe("欧路检查超时，请稍后重试。");
  h.fetcher.mockRejectedValueOnce(new TypeError(privateToken));
  expect(backfillViewSchema.parse(await h.check()).checkError).toBe(
    "无法连接欧路，请检查网络后重试。",
  );
  expect(JSON.stringify(h.state.localProgress)).not.toContain(privateToken);
  expect(backfillViewSchema.parse(await h.check()).checkError).toBeNull();
});

it("keeps an unfinished Eudic page and error when its access is temporarily disabled", async () => {
  const h = harness();
  h.fetcher.mockRejectedValueOnce(new TypeError(privateToken));
  await h.check();
  h.allowEudic.mockResolvedValueOnce(false);
  const skipped = backfillViewSchema.parse(await h.check());
  expect(skipped.checkError).toBe("无法连接欧路，请检查网络后重试。");
  expect(skipped.lastCheckedAt).toBeNull();
  expect(h.state.localProgress.eudicPage).toBe(0);
  expect(h.fetcher).toHaveBeenCalledOnce();
});

it("shows a local-source error while retaining the existing queue", async () => {
  const h = harness(true, ["river"]);
  h.snapshot.mockRejectedValueOnce(new Error(privateToken));
  await h.runtime.refresh();
  expect(backfillViewSchema.parse(await h.handle("open"))).toMatchObject({
    status: { pendingCount: 1 },
    checkError: "无法读取本机收藏，请稍后重新检查。",
  });
  expect(h.openTab).toHaveBeenCalledOnce();
  expect(h.fetcher).not.toHaveBeenCalled();
});

it("does not open a tab without site consent, including revocation during cached validation", async () => {
  const h = harness(true, ["river"]);
  h.allowPage.mockResolvedValueOnce(false);
  expect(await h.handle("open")).toMatchObject({
    code: "permission",
    error: "请先在设置中允许扇贝回填，并启用扇贝网站。",
  });
  expect(h.fetcher).not.toHaveBeenCalled();
  h.allowPage.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await h.handle("open")).toMatchObject({ code: "permission" });
  expect(h.openTab).not.toHaveBeenCalled();
});
