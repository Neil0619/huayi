import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test, expect, type Page } from "@playwright/test";
import { build } from "vite";
import {
  backfillStatus,
  discoverBackfill,
  claimBackfillBatch,
  resolveBackfillBatch,
  markBackfillUnknown,
} from "@huayi/store-domain";
import { createStoreExtensionConfig } from "../vite.config.js";
import {
  createPackagedWorkerStorage,
  loadPackagedWorker,
} from "../src/packaged-worker.test-support.js";
import { createChromeStoreSettings } from "../src/service-worker/store-settings.js";
import { createBrowserDeviceVault } from "../src/vault/browser-device-vault.js";
import { createChromeVaultStorageAdapter } from "../src/vault/chrome-vault-storage.js";
import { createBackfillVault, initialBackfillStorage } from "../src/backfill/backfill-vault.js";

// Uses the repository's existing React installation only in this offline page fixture.
const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
const h=React.createElement;
window.submissions=[];
function Upload() {
  const [open,setOpen]=React.useState(false);
  const [value,setValue]=React.useState('');
  const [message,setMessage]=React.useState('');
  const [uploading,setUploading]=React.useState(false);
  const words=value.split(/\\n/).filter(Boolean);
  return h('main',null,
    h('div',{className:'Collection_batchUploadBtn__fixture',onClick:()=>setOpen(true)},'批量上传'),
    open && h('div',{className:'index_container__37q1F'},
      h('div',{className:'index_title__3D8B1'},'批量添加到生词本'),
      h('textarea',{value,disabled:uploading,placeholder:'在这里输入需要添加的单词。',onChange:e=>{setValue(e.target.value);setMessage('');}}),
      h('div',{className:'index_counter__3Dkby'},String(words.length)),
      message && h('div',{className:'index_msg__3o1cu'},message),
      h('div',{className:'index_submit__1wWYx'+(uploading||!words.length?' index_disabled__3qVue':''),onClick:e=>{
        if(uploading||!words.length)return;
        window.submissions.push({words:[...words],trusted:e.nativeEvent.isTrusted});
        setUploading(true);
        setTimeout(()=>{setValue('');setMessage('添加完成（'+words.length+'/'+words.length+'）');setUploading(false);},0);
      }},uploading?'上传中...':'批量添加')
    )
  );
}
createRoot(document.getElementById('fixture')).render(h(Upload));
`;
const words = Array.from(
  { length: 496 },
  (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26), 97 + (index % 26))}`,
);
let directory: string;
let workerSource: string;
let contentSource: string;
let fixtureSource: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "huayi-shanbay-browser-"));
  for (const mode of ["background", "content"] as const) {
    const config = createStoreExtensionConfig(mode, "hosted-acceptance");
    await build({
      ...config,
      configFile: false,
      build: { ...config.build, outDir: join(directory, mode) },
    });
  }
  const fixtureEntry = join(directory, "fixture-entry.js");
  await writeFile(fixtureEntry, fixture);
  await build({
    configFile: false,
    logLevel: "error",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    resolve: {
      alias: {
        "react-dom/client": webRequire.resolve("react-dom/client"),
        react: webRequire.resolve("react"),
      },
    },
    build: {
      outDir: join(directory, "fixture"),
      lib: {
        entry: fixtureEntry,
        formats: ["iife"],
        name: "ShanbayFixture",
        fileName: () => "fixture.js",
      },
    },
  });
  workerSource = await readFile(join(directory, "background/service-worker.js"), "utf8");
  contentSource = await readFile(join(directory, "content/content-script.js"), "utf8");
  fixtureSource = await readFile(join(directory, "fixture/fixture.js"), "utf8");
});
test.afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function startPage(page: Page, review: boolean | "unknown" = false) {
  const extensionId = "hoijjhgcckfhbcefoclgbhkgninnkknd";
  const collectionUrl = "https://web.shanbay.com/wordsweb/#/collection";
  const storage = createPackagedWorkerStorage();
  const settings = createChromeStoreSettings(storage.local);
  await settings.grantNetworkConsent(new Date());
  await settings.grantRecipientConsent("shanbay", new Date());
  await settings.setRecipientEnabled("shanbay", true);
  const adapter = createChromeVaultStorageAdapter(storage);
  const device = createBrowserDeviceVault({ crypto: globalThis.crypto, storage: adapter });
  const vault = createBackfillVault(device, {
    read: adapter.readPersistent,
    write: adapter.writePersistent,
    delete: adapter.deletePersistent,
  });
  const seeded = initialBackfillStorage();
  seeded.localEnabled = true;
  const now = new Date().toISOString();
  const seedWords = review === "unknown" ? words.slice(0, 40) : review ? words.slice(0, 52) : words;
  discoverBackfill(seeded.local, seedWords, "local", now);
  if (review === "unknown") {
    for (let i = 0; i < 2; i += 1) {
      const token = crypto.randomUUID();
      expect(
        claimBackfillBatch(seeded.local, { now, holder: "offline-seed", token, limit: 20 })
          ?.headwords,
      ).toHaveLength(20);
      markBackfillUnknown(seeded.local, token, now);
    }
  } else if (review) {
    const lease = { now, holder: "offline-seed", token: crypto.randomUUID() };
    expect(claimBackfillBatch(seeded.local, lease)?.headwords).toHaveLength(52);
    expect(
      resolveBackfillBatch(seeded.local, {
        ...lease,
        confirmed: [],
        rejected: seedWords,
        findLemma: () => null,
      }),
    ).toBe(true);
  }
  await vault.write(seeded);
  const worker = loadPackagedWorker(workerSource, extensionId, storage);
  await expect(
    worker.sendMessage({
      type: "store/backfill-open",
      expectedScope: "local",
      ...(review ? { view: "review" } : {}),
    }),
  ).resolves.toMatchObject({ status: { pendingCount: review ? 0 : 496 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // All requests, including the Shanbay URL, are fulfilled offline or blocked.
  await page.route("**/*", (route) =>
    route.request().isNavigationRequest()
      ? route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html><body><div id="fixture"></div></body></html>',
        })
      : route.abort(),
  );
  await page.exposeFunction("offlineMessage", (message: unknown) =>
    worker.sendMessage(message, {
      id: extensionId,
      url: collectionUrl,
      tab: { id: 1 },
      documentId: "browser-document",
      frameId: 0,
    }),
  );
  await page.addInitScript(
    ({ extensionId }) => {
      Reflect.set(globalThis, "chrome", {
        runtime: {
          id: extensionId,
          onMessage: { addListener: () => undefined },
          getURL: (path: string) => `https://fixture.invalid/${path}`,
          sendMessage: (message: unknown) => Reflect.get(globalThis, "offlineMessage")(message),
        },
      });
    },
    { extensionId },
  );
  await page.goto(collectionUrl);
  await page.addScriptTag({ content: fixtureSource });
  await page.locator(".Collection_batchUploadBtn__fixture").waitFor();
  await page.addScriptTag({ content: contentSource });
  return { vault, worker, pageErrors };
}

test("actual content and worker bundles confirm 496 words through five trusted clicks on Shanbay-shaped React controls", async ({
  page,
}) => {
  const { vault, worker, pageErrors } = await startPage(page);
  const counter = page.locator(".index_counter__3Dkby");
  await expect(counter).toHaveText("100");
  let clicks = 0;
  for (const remaining of [396, 296, 196, 96, 0]) {
    expect(await page.evaluate(() => Reflect.get(window, "submissions").length)).toBe(clicks);
    clicks += 1;
    await page.locator(".index_submit__1wWYx").click();
    if (remaining > 0) await expect(counter).toHaveText(String(Math.min(100, remaining)));
    await expect
      .poll(async () => backfillStatus((await vault.read()).local).pendingCount)
      .toBe(remaining);
  }
  await expect(page.locator("[data-backfill-notice]")).toContainText("已处理完毕");
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "submissions").map((entry: { words: string[]; trusted: boolean }) => ({
        count: entry.words.length,
        trusted: entry.trusted,
      })),
    ),
  ).toEqual([
    { count: 100, trusted: true },
    { count: 100, trusted: true },
    { count: 100, trusted: true },
    { count: 100, trusted: true },
    { count: 96, trusted: true },
  ]);
  const saved = await vault.read();
  expect(backfillStatus(saved.local)).toEqual({
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
  });
  expect(
    Object.values(saved.local.targets).filter((target) => target.confirmedAt !== null),
  ).toHaveLength(496);
  expect(worker.badges.at(-1)).toBe("");
  expect(worker.requests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("two old unknown batches can finish without resubmission and stay dismissed after reopening", async ({
  page,
}, testInfo) => {
  const { vault, worker, pageErrors } = await startPage(page, "unknown");
  const panel = page.locator("[data-huayi-backfill]");
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 0 · 待确认 40");
  await expect(panel.getByRole("button", { name: "不再提醒", exact: true })).toHaveCount(2);
  await expect(panel.locator("details")).toHaveCount(2);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await panel.screenshot({ path: testInfo.outputPath(`unknown-review-${size.width}.png`) });
    const bounds = await panel.boundingBox();
    expect(
      bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= size.width &&
        bounds.y + bounds.height <= size.height,
    ).toBe(true);
  }
  await panel.getByRole("button", { name: "全部丢弃（40）", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeInViewport();
  await expect(panel.getByRole("alert")).toContainText("不再提醒");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(backfillStatus((await vault.read()).local).unknownCount).toBe(40);
  await panel.getByRole("button", { name: "全部丢弃（40）", exact: true }).click();
  await panel.getByRole("button", { name: "确认全部丢弃（40）", exact: true }).click();
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 0");
  await expect(panel.locator(".help")).toContainText("已处理完毕，可以收起");
  await expect(panel.locator(".row")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "全部丢弃（0）", exact: true })).toBeHidden();
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "submissions"))).toEqual([]);
  const saved = await vault.read();
  expect(Object.values(saved.local.targets).every((target) => target.confirmedAt === null)).toBe(
    true,
  );
  expect(Object.values(saved.local.sources).every((source) => source.state === "discarded")).toBe(
    true,
  );
  expect(worker.badges.at(-1)).toBe("");
  await panel.screenshot({ path: testInfo.outputPath("unknown-review-complete.png") });
  await panel.getByRole("button", { name: "收起", exact: true }).click();
  await panel.getByRole("button", { name: "需处理", exact: true }).click();
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 0");
  await expect(panel.locator(".row")).toHaveCount(0);
  expect(worker.requests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("52 unresolved words are handled in the page panel and edits rejoin trusted batch submission", async ({
  page,
}, testInfo) => {
  const { vault, worker, pageErrors } = await startPage(page, true);
  const panel = page.locator("[data-huayi-backfill]");
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 52");
  await expect(panel.getByRole("textbox")).toHaveCount(52);
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(
    (await vault.read()).local.batches.filter((batch) => batch.state === "prepared"),
  ).toHaveLength(0);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 700 },
  ]) {
    await page.setViewportSize(size);
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error("Missing page panel");
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.width + bounds.x).toBeLessThanOrEqual(size.width);
    expect(bounds.height + bounds.y).toBeLessThanOrEqual(size.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await panel.screenshot({ path: testInfo.outputPath(`backfill-review-${size.width}.png`) });
  }
  await panel.getByRole("textbox", { name: "wordac 的回填目标", exact: true }).fill("draft");
  await panel.getByRole("button", { name: "刷新列表", exact: true }).click();
  await expect(panel.getByRole("textbox", { name: "wordac 的回填目标", exact: true })).toHaveValue(
    "draft",
  );
  await panel
    .locator(".row")
    .filter({ has: page.getByRole("textbox", { name: "wordab 的回填目标", exact: true }) })
    .getByRole("button", { name: "跳过", exact: true })
    .click();
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 51");
  const first = panel
    .locator(".row")
    .filter({ has: page.getByRole("textbox", { name: "wordaa 的回填目标", exact: true }) });
  await first.getByRole("textbox").fill("apple");
  await first.getByRole("button", { name: "修改并重试", exact: true }).click();
  await expect(panel.locator(".summary")).toHaveText("待回填 1 · 需处理 50");
  expect((await vault.read()).local.sources.wordab?.state).toBe("discarded");
  expect((await vault.read()).local.sources.wordaa?.target).toBe("apple");
  await expect(page.locator("textarea")).toHaveCount(0);
  await panel.getByRole("button", { name: "继续回填", exact: true }).click();
  await expect(page.locator("textarea")).toHaveValue("apple");
  expect(await page.evaluate(() => Reflect.get(window, "submissions"))).toEqual([]);
  await page.locator(".index_submit__1wWYx").click();
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 50");
  expect((await vault.read()).local.sources.wordaa?.state).toBe("confirmed");
  expect(worker.badges.at(-1)).toBe("!");
  await panel.getByRole("button", { name: "全部丢弃（50）", exact: true }).click();
  expect(backfillStatus((await vault.read()).local).unresolvedCount).toBe(50);
  await panel.getByRole("button", { name: "确认全部丢弃（50）", exact: true }).click();
  await expect(panel.locator(".summary")).toHaveText("待回填 0 · 需处理 0");
  const discarded = await vault.read();
  expect(
    Object.values(discarded.local.sources).filter((source) => source.state === "discarded"),
  ).toHaveLength(51);
  expect(discarded.local.sources.wordaa?.state).toBe("confirmed");
  expect(worker.badges.at(-1)).toBe("");
  expect(worker.requests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
