import { afterEach, expect, it, vi } from "vitest";
import { discoverBackfill } from "@huayi/store-domain";
import { createBackfillAuthority } from "./backfill-authority.js";
import { createBackfillCloudApi } from "./backfill-cloud-api.js";
import { initializeBackfillPanel } from "./backfill-panel.js";
import { createBackfillRuntime } from "./backfill-runtime.js";
import { initialBackfillProgress, initialBackfillStorage } from "./backfill-vault.js";

const privateToken = "private-session-token-never-display";
const remote = {
  scopeId: "account-a",
  enabled: true,
  dailyHour: 8,
  revision: 1,
  pendingCount: 3,
  unresolvedCount: 1,
  unknownCount: 0,
  lastCheckedAt: null,
};
const findButton = (text: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent === text);

function harness(expiresAt = "2099-01-01T00:00:00Z") {
  let progressChanged: () => void = () => undefined;
  const state = initialBackfillStorage();
  state.localEnabled = true;
  discoverBackfill(state.local, ["privateword"], "local", new Date().toISOString());
  state.scopes[remote.scopeId] = {
    status: remote,
    progress: initialBackfillProgress(),
    adopted: true,
    localExcluded: [],
    adoptIndex: 0,
    adoptPhase: "evidence",
    pending: null,
  };
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes("/unresolved"))
      return Response.json({
        items: [
          {
            headword: "walking",
            target: "walking",
            origins: ["local"],
            attempt: "original",
            state: "unresolved",
            updatedAt: "2026-09-15T00:00:00Z",
          },
        ],
        unknownBatches: [],
        revision: 1,
        nextCursor: null,
      });
    return Response.json(
      init?.method === "POST"
        ? { status: remote, accepted: true, batch: null, nextCursor: null }
        : remote,
    );
  });
  const badge = vi.fn(async (_text: string) => {
    void _text;
  });
  const authority = createBackfillAuthority({
    vault: { read: async () => state, write: async () => progressChanged() },
    session: {
      readSession: async () => ({
        token: privateToken,
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
    api: createBackfillCloudApi("https://api.example.test", "1.0.0", fetcher),
    lock: async (operation) => operation(),
  });
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
    openTab: async () => 1,
    activateTab: async () => undefined,
    setBadge: badge,
    scheduleMore: () => undefined,
  });
  const sendMessage = vi.fn((message: unknown) =>
    runtime.handle(message, {
      id: "extension",
      url: "chrome-extension://extension/popup.html",
    }),
  );
  const mount = () =>
    initializeBackfillPanel({
      container: document.body,
      sendMessage,
      subscribeProgress(callback) {
        progressChanged = callback;
        return () => {
          progressChanged = () => undefined;
        };
      },
    });
  return { mount, fetcher, badge, state, sendMessage, hydrate: () => runtime.refresh() };
}

afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
});

it.each([
  [404, "扇贝回填服务暂未就绪，请稍后重试。"],
  [401, "账号连接已失效，请在设置中重新连接后重试。"],
  [403, "账号连接已失效，请在设置中重新连接后重试。"],
  [429, "操作未完成，请刷新回填状态后重试。"],
  [503, "操作未完成，请刷新回填状态后重试。"],
  [200, "操作未完成，请刷新回填状态后重试。"],
  [0, "无法连接回填服务，请检查网络后重试。"],
])("ends initial loading with safe, accurate copy for status failure %s", async (status, copy) => {
  const h = harness();
  if (status === 0) h.fetcher.mockRejectedValueOnce(new TypeError(privateToken));
  else h.fetcher.mockResolvedValueOnce(new Response(privateToken, { status }));
  await h.hydrate();
  h.mount();
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy));
  expect(document.body.textContent).not.toContain("正在读取");
  expect(document.body.textContent).not.toContain(privateToken);
  expect(findButton("重试")?.disabled).toBe(false);
  expect(findButton("开启扇贝回填")).toBeUndefined();
  expect(h.badge).toHaveBeenLastCalledWith("!");
  expect(h.state.local.batches).toEqual([]);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(await h.sendMessage.mock.results[0]?.value)).not.toContain(privateToken);
});

it("recovers from an HTTP 404 through a single retry without enabling stale actions", async () => {
  const h = harness();
  h.fetcher.mockResolvedValueOnce(new Response("missing", { status: 404 }));
  await h.hydrate();
  h.mount();
  await vi.waitFor(() => expect(findButton("重试")?.disabled).toBe(false));
  let finish: (response: Response) => void = () => undefined;
  h.fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const retry = findButton("重试");
  retry?.click();
  retry?.click();
  await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(document.body.textContent).not.toContain("待回填 3"));
  expect(findButton("打开扇贝回填")).toBeUndefined();
  finish(Response.json(remote));
  await vi.waitFor(() => expect(document.body.textContent).toContain("待回填 3"));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("");
  expect(findButton("打开扇贝回填")?.disabled).toBe(false);
  expect(findButton("重试")).toBeUndefined();
  expect(h.badge).toHaveBeenLastCalledWith("3");
  expect(h.state.local.batches).toEqual([]);
});

it("asks to reconnect an expired session without reading the local fallback queue", async () => {
  const h = harness("2020-01-01T00:00:00Z");
  h.mount();
  await vi.waitFor(() => expect(findButton("重试")?.disabled).toBe(false));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "账号连接已失效，请在设置中重新连接后重试。",
  );
  expect(document.body.textContent).not.toContain("正在读取");
  expect(document.body.textContent).not.toContain("待回填 1");
  expect(h.fetcher).not.toHaveBeenCalled();
  expect(h.badge).toHaveBeenLastCalledWith("!");
  expect(h.state.local.batches).toEqual([]);
});

it("retains cached counts after network failure but removes them after authentication fails", async () => {
  const h = harness();
  await h.hydrate();
  const panel = h.mount();
  await vi.waitFor(() => expect(findButton("需处理")?.disabled).toBe(false));
  findButton("需处理")?.click();
  await vi.waitFor(() => expect(findButton("需处理")?.disabled).toBe(false));
  expect(document.querySelector("input")).toBeNull();
  h.fetcher.mockRejectedValueOnce(new TypeError(privateToken));
  await h.hydrate();
  await panel.refresh();
  expect(document.body.textContent).toContain("待回填 3");
  expect(findButton("打开扇贝回填")?.disabled).toBe(false);
  h.fetcher.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
  await h.hydrate();
  await panel.refresh();
  await vi.waitFor(() => expect(document.body.textContent).not.toContain("待回填 3"));
  expect(document.querySelector("input")).toBeNull();
  expect(findButton("重试")?.disabled).toBe(false);
  findButton("重试")?.click();
  await vi.waitFor(() => expect(findButton("打开扇贝回填")?.disabled).toBe(false));
  expect(document.querySelector("input")).toBeNull();
  expect(h.state.local.batches).toEqual([]);
});

it("ignores unrecognized error messages from the runtime", async () => {
  initializeBackfillPanel({
    container: document.body,
    sendMessage: async () => ({ error: privateToken, code: "unknown" }),
  });
  await vi.waitFor(() => expect(findButton("重试")?.disabled).toBe(false));
  expect(document.body.textContent).not.toContain(privateToken);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "操作未完成，请刷新回填状态后重试。",
  );
});
