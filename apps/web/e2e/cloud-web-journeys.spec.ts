import { expect, test } from "@playwright/test";
import { contractFixtures } from "@huayi/cloud-contracts";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";
const storeFixture = "http://127.0.0.1:4173/apps/store-extension/e2e/fixtures/cloud-release.html";

test("actual Web bundle confirms one candidate and rereads it from the learning library", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "candidate-analysis",
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/app`);
  await expect(page.getByRole("heading", { name: "待分析", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "待收藏" }).click();
  await expect(page.getByRole("heading", { name: "待整理", level: 1 })).toBeVisible();
  await page.getByRole("textbox", { exact: true, name: "表达" }).fill("to be completely frank");
  await page.getByLabel("标签（逗号分隔）").fill("writing, conversation");
  await page.getByRole("button", { name: "确认所选候选" }).click();
  await expect(page.getByRole("heading", { name: "待整理箱已经清空" })).toBeVisible();

  await page.getByRole("link", { name: "学习库" }).click();
  await expect(page).toHaveURL(`${webOrigin}/library`);
  await expect(page.getByRole("heading", { name: "学习库", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /to be completely frank/u })).toBeVisible();
  await page.getByRole("button", { name: /to be completely frank/u }).click();
  await page.getByRole("button", { name: "归档学习项" }).click();
  await expect(
    page.getByText("归档会停止新的练习，但保留内容、排期和全部练习历史。确认继续？"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByRole("button", { name: "恢复学习项" })).toBeVisible();
  await page.getByLabel("状态").selectOption("true");
  await expect(page.getByRole("button", { name: /to be completely frank/u })).toBeVisible();
  await page.getByRole("button", { name: /to be completely frank/u }).click();
  await page.getByRole("button", { name: "恢复学习项" }).click();
  await expect(page.getByRole("button", { name: "归档学习项" })).toBeVisible();
  await page.getByLabel("状态").selectOption("false");
  await expect(page.getByRole("button", { name: /to be completely frank/u })).toBeVisible();

  authority.markLearningItemPracticed("item-1");
  await page.reload();
  await page.getByRole("button", { name: /to be completely frank/u }).click();
  await expect(page.getByRole("button", { name: "删除学习项", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "归档学习项" }).click();
  await page.getByRole("button", { name: "确认归档" }).click();
  await expect(page.getByRole("button", { name: "恢复学习项" })).toBeVisible();
  await page.getByLabel("状态").selectOption("true");
  const archivedItem = page.getByRole("button", { name: /to be completely frank/u });
  await expect(archivedItem).toBeVisible();
  await archivedItem.click();
  await expect(page.getByRole("button", { name: "永久删除学习项" })).toBeVisible();
  await page.getByRole("button", { name: "永久删除学习项" }).click();
  await expect(page.getByText(/既有练习题、作答、对话和反馈会保留/u)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === "/v1/learning-items/item-1" &&
        response.ok(),
    ),
    page.getByRole("button", { name: "确认永久删除" }).click(),
  ]);
  await expect(page.getByText("当前筛选下没有学习项")).toBeVisible();

  const snapshot = authority.snapshot();
  expect(snapshot).toMatchObject({ analysisCount: 1, importCount: 0, itemCount: 0 });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/analyses/analysis-1/candidates:confirm",
    proof: "write-valid",
  });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/learning-items/item-1/archive",
    proof: "write-valid",
  });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/learning-items/item-1/restore",
    proof: "write-valid",
  });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "DELETE",
    path: "/v1/learning-items/item-1",
    proof: "write-valid",
  });
});

test("packaged Store content captures a sentence and Web explicitly deep-analyzes it", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);

  await page.goto(storeFixture);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("调查整个冬天都在持续");
  await panel.locator("[data-study-capture-create]").click();
  await expect(panel).toContainText("已加入待学习");
  await expect(page.getByTestId("cloud-status")).toHaveText("created");

  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "extension",
    method: "POST",
    path: "/v1/study-captures",
    proof: "write-valid",
  });

  await page.goto(`${webOrigin}/app`);
  await expect(
    page.getByRole("heading", {
      name: "The investigation remained active all winter.",
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始深度分析" }).click();
  await expect(page.getByRole("tab", { name: "待收藏", selected: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "The investigation remained active all winter.",
      level: 2,
    }),
  ).toBeVisible();
  await page.getByRole("textbox", { exact: true, name: "表达" }).fill("to be completely frank");
  await page.getByLabel("标签（逗号分隔）").fill("investigation, writing");
  await page.getByRole("button", { name: "确认所选候选" }).click();
  await expect(page.getByRole("heading", { name: "待整理箱已经清空" })).toBeVisible();
  await page.getByRole("link", { name: "学习库" }).click();
  await expect(page.getByRole("button", { name: /to be completely frank/u })).toBeVisible();
  expect(authority.snapshot()).toMatchObject({
    analysisCount: 1,
    captureCount: 1,
    importCount: 0,
    itemCount: 1,
  });
});

test("platform query uses the production router but creates no analysis or capture", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?platform`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("调查整个冬天都在持续");
  expect(authority.snapshot()).toMatchObject({
    analysisCount: 0,
    captureCount: 0,
    extensionQueryCount: 1,
  });
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "extension",
    method: "POST",
    path: "/v1/extension-queries:stream",
    proof: "write-valid",
  });

  await page.goto(`${webOrigin}/app`);
  await page.getByRole("tab", { name: "待收藏" }).click();
  await expect(page.getByRole("heading", { name: "待整理箱已经清空" })).toBeVisible();
});

test("platform quota exhaustion never falls back to the local BYOK engine", async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "platform-query-quota",
  });
  await authority.install(page);
  await page.goto(`${storeFixture}?platform`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("平台模型额度已用完");
  await expect(panel).not.toContainText("调查整个冬天都在持续");
  expect(authority.snapshot()).toMatchObject({
    analysisCount: 0,
    captureCount: 0,
    extensionQueryCount: 1,
  });
});

test("local word save succeeds first and an enabled CloudWordCopy appears in Web", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(panel).toContainText("已保存到本地生词本");
  await expect(page.getByTestId("cloud-status")).toHaveText("local:1");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 1, wordCount: 1 });

  await page.goto(`${webOrigin}/words`);
  const word = page.getByRole("button", { name: /investigation/u });
  await expect(word).toBeVisible();
  await word.click();
  await expect(page.getByRole("heading", { level: 2, name: "investigation" })).toBeFocused();
  await expect(page.getByText("The investigation remained active all winter.")).toBeVisible();
});

test("disabled CloudWordCopy keeps the local word and performs zero cloud writes", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?word-copy-disabled`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(panel).toContainText("已保存到本地生词本");
  await expect(page.getByTestId("cloud-status")).toHaveText("local:1");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });
  expect(authority.snapshot().requestFacts.some((fact) => fact.path === "/v1/words:copy")).toBe(
    false,
  );
});

test("offline CloudWordCopy preserves the local word and reconnects from the shared outbox", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?offline`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(panel).toContainText("已保存到本地生词本");
  await expect(page.getByTestId("cloud-status")).toHaveText("local:1");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-huayi-store-overlay]")).toHaveCount(0);
  await page.getByTestId("cloud-reconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("submitted");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 1, wordCount: 1 });
  await page.goto(`${webOrigin}/words`);
  await expect(page.getByRole("button", { name: /investigation/u })).toBeVisible();
});

test("an explicit local-word preview imports 201 words in resumable production batches", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?batch-import`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await expect(page.locator("[data-local-word-import-panel]")).toBeVisible();
  await expect(page.getByTestId("cloud-status")).toHaveText("local:201");

  await page.locator("[data-local-word-import-preview]").click();
  await expect(page.locator("[data-local-word-import-summary]")).toHaveText(
    "本次将导入 201 个词条、200 条语境。",
  );
  await expect(page.locator("[data-local-word-import-confirm]")).toBeEnabled();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("确认导入 201 个词条、200 条语境？");
    await dialog.accept();
  });
  await page.locator("[data-local-word-import-confirm]").click();
  await expect(page.locator("[data-local-word-import-summary]")).toHaveText(
    "已处理 100/201 个词条、99/200 条语境。",
  );
  expect(authority.snapshot()).toMatchObject({
    wordCount: 100,
    wordImportCount: 1,
  });

  await page.getByTestId("cloud-run-import-alarm").click();
  await expect(page.locator("[data-local-word-import-summary]")).toHaveText(
    "已处理 200/201 个词条、199/200 条语境。",
  );
  await page.getByTestId("cloud-run-import-alarm").click();
  await expect(page.locator("[data-local-word-import-status]")).toHaveText(
    "导入完成；本机生词未被删除，Web 现有笔记未被覆盖。",
  );
  await expect(page.getByTestId("cloud-status")).toHaveText("local:201");
  expect(authority.snapshot()).toMatchObject({
    wordCount: 201,
    wordImportCount: 3,
  });

  await page.goto(`${webOrigin}/words`);
  await expect(page.getByRole("button", { name: "archiveword000" })).toBeVisible();
});

test("a local Eudic page remains local until explicit preview and Cloud import", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?eudic-local-import`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-run-eudic-import").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("local:2");
  expect(authority.snapshot()).toMatchObject({ wordCount: 0, wordImportCount: 0 });

  await page.locator("[data-local-word-import-preview]").click();
  await expect(page.locator("[data-local-word-import-summary]")).toHaveText(
    "本次将导入 2 个词条、1 条语境。",
  );
  page.once("dialog", async (dialog) => dialog.accept());
  await page.locator("[data-local-word-import-confirm]").click();
  await expect(page.locator("[data-local-word-import-status]")).toHaveText(
    "导入完成；本机生词未被删除，Web 现有笔记未被覆盖。",
  );
  await expect(page.getByTestId("cloud-status")).toHaveText("local:2");
  expect(authority.snapshot()).toMatchObject({ wordCount: 2, wordImportCount: 1 });

  await page.goto(`${webOrigin}/words`);
  await expect(page.getByRole("button", { name: "evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "hypothesis" })).toBeVisible();
  await page.getByRole("button", { name: "evidence" }).click();
  await expect(page.getByText("The evidence remained persuasive.")).toBeVisible();
});

test("a Web Eudic export is leased and completed by the production Store bridge", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  expect(authority.snapshot()).toMatchObject({ wordCount: 1 });

  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByRole("heading", { name: "欧路词典 · 导出" })).toBeVisible();
  await expect(page.getByText("等待插件处理")).toBeVisible();
  expect(authority.snapshot()).toMatchObject({ wordbookJobCount: 1 });

  await page.goto(storeFixture);
  await page.getByTestId("cloud-run-wordbook-job").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("wordbook-processed-local:0");
  await page.goto(`${webOrigin}/words/wordbooks`);
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已完成 1/1 · 失败 0")).toBeVisible();
});

test("a failed Web Eudic export is explicitly retried and completed", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();

  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("button", { name: "创建任务" }).click();
  await page.goto(`${storeFixture}?eudic-cloud-failure`);
  await page.getByTestId("cloud-run-wordbook-job").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("wordbook-processed-local:0");

  await page.goto(`${webOrigin}/words/wordbooks`);
  await expect(page.getByText("需要处理", { exact: true })).toBeVisible();
  await expect(page.getByText("网络暂时不可用")).toBeVisible();
  await expect(page.getByText("已完成 0/1 · 失败 1")).toBeVisible();
  await page.getByRole("button", { name: "重试失败项" }).click();
  await expect(page.getByText("等待插件处理", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("任务已重新排队。");

  await page.goto(storeFixture);
  await page.getByTestId("cloud-run-wordbook-job").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("wordbook-processed-local:0");
  await page.goto(`${webOrigin}/words/wordbooks`);
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已完成 1/1 · 失败 0")).toBeVisible();
});

test("a Cloud Eudic import writes Web words without mutating the Store local lexicon", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("radio", { name: /从欧路导入/u }).check();
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByRole("heading", { name: "欧路词典 · 导入" })).toBeVisible();

  await page.goto(storeFixture);
  await page.getByTestId("cloud-run-wordbook-job").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("wordbook-processed-local:0");
  expect(authority.snapshot()).toMatchObject({ wordCount: 1, wordbookJobCount: 1 });

  await page.goto(`${webOrigin}/words`);
  await page.getByRole("button", { name: "make do" }).click();
  await expect(page.getByText("The imported phrase works in context.")).toBeVisible();
});

test("a Shanbay Cloud job exposes only local aliases and waits for explicit confirmation", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();

  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("radio", { name: /导出到扇贝/u }).check();
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByRole("heading", { name: "扇贝 · 导出" })).toBeVisible();

  await page.goto(`${storeFixture}?shanbay-cloud`);
  await page.getByTestId("cloud-claim-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-ready:investigation");
  await expect(page.getByTestId("cloud-confirm-shanbay")).toBeEnabled();
  const visibleHtml = await page.locator("body").innerHTML();
  expect(visibleHtml).not.toContain("30000000-0000-4000-8000-000000000001");
  expect(visibleHtml).not.toContain("wordbook-e2e-lease-token");
  await page.getByTestId("cloud-confirm-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-confirmed");

  await page.goto(`${webOrigin}/words/wordbooks`);
  await expect(page.getByText("已完成", { exact: true })).toBeVisible();
  await expect(page.getByText("已完成 1/1 · 失败 0")).toBeVisible();
});

test("a Shanbay Cloud batch reports an exact partial success to Web", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  for (const testId of ["cloud-word", "cloud-word-secondary"]) {
    await page.getByTestId(testId).dblclick();
    const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
    await panel.locator('[data-action="translate"]').click();
    await panel.locator("[data-save-word]").click();
    await page.keyboard.press("Escape");
  }
  expect(authority.snapshot()).toMatchObject({ wordCount: 2 });

  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("radio", { name: /导出到扇贝/u }).check();
  await page.getByRole("button", { name: "创建任务" }).click();
  await page.goto(`${storeFixture}?shanbay-cloud`);
  await page.getByTestId("cloud-claim-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-ready:investigation,evidence");
  await page.getByTestId("cloud-partial-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-partial");

  await page.goto(`${webOrigin}/words/wordbooks`);
  await expect(page.getByText("需要处理", { exact: true })).toBeVisible();
  await expect(page.getByText("外部词典返回了无法识别的数据")).toBeVisible();
  await expect(page.getByText("已完成 1/2 · 失败 1")).toBeVisible();
});

test("a cancelled Shanbay job stays cancelled after its current lease reports late", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(storeFixture);
  await page.getByTestId("cloud-word").dblclick();
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();

  await page.goto(`${webOrigin}/words/wordbooks`);
  await page.getByRole("radio", { name: /导出到扇贝/u }).check();
  await page.getByRole("button", { name: "创建任务" }).click();
  await page.goto(`${storeFixture}?shanbay-cloud`);
  await page.getByTestId("cloud-claim-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-ready:investigation");

  const webPage = await page.context().newPage();
  await authority.install(webPage);
  await webPage.goto(`${webOrigin}/words/wordbooks`);
  await expect(webPage.getByText("处理中", { exact: true })).toBeVisible();
  await webPage.getByRole("button", { name: "取消任务…" }).click();
  await webPage.getByRole("button", { name: "确认取消" }).click();
  await expect(webPage.getByText("已取消", { exact: true })).toBeVisible();
  await expect(webPage.getByRole("status")).toHaveText(
    "任务已取消；已提交的回执不会被伪装成撤回。",
  );

  await page.getByTestId("cloud-confirm-shanbay").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("shanbay-confirmed");
  await webPage.reload();
  await expect(webPage.getByText("已取消", { exact: true })).toBeVisible();
  await expect(webPage.getByText("已完成 1/1 · 失败 0")).toBeVisible();
  await webPage.close();
});

test("disconnect clears account queues but preserves the independent local lexicon", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?offline`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  let panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("local:1");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });

  await page.keyboard.press("Escape");
  await page.getByTestId("cloud-disconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("disconnect-failed");
  expect(authority.snapshot()).toMatchObject({ extensionSessionCount: 1, wordCount: 0 });
  await page.getByTestId("cloud-network-only").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("network-restored");
  await page.getByTestId("cloud-disconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("disconnected-local:1");
  expect(authority.snapshot()).toMatchObject({ extensionSessionCount: 0, wordCount: 0 });
  expect(
    authority
      .snapshot()
      .requestFacts.some(
        (fact) => fact.method === "DELETE" && fact.path === "/v1/extension-session",
      ),
  ).toBe(true);
  const staleTokenStatus = await page.evaluate(async () => {
    const response = await fetch("https://api.huayi.invalid/v1/words", {
      headers: {
        Authorization: "HuayiExtension cloud-e2e-extension-session-token-000000000000",
        "X-Huayi-Client-Version": "1.0.0",
      },
    });
    return response.status;
  });
  expect(staleTokenStatus).toBe(401);
  await page.getByTestId("cloud-reconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("session-unavailable");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });
  await page.getByTestId("cloud-word").dblclick();
  panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel.locator("[data-save-word]")).toHaveAttribute("data-save-state", "saved");
  await expect(panel.locator("[data-save-word]")).toHaveAttribute("aria-label", "已加入本地生词本");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });
  await page.goto(`${webOrigin}/settings/devices`);
  await expect(page.getByRole("heading", { name: "没有已连接的扩展设备" })).toBeVisible();
});

test("account switch drops the old queue, keeps local words, and uses the new session", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?offline`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-word").dblclick();
  let panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("local:1");

  await page.keyboard.press("Escape");
  await page.getByTestId("cloud-network-only").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("network-restored");
  await page.getByTestId("cloud-switch-account").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("switched-local:1");
  await page.getByTestId("cloud-reconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("submitted");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 0, wordCount: 0 });

  await page.getByTestId("cloud-word").dblclick();
  panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel.locator("[data-save-word]")).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");
  await page.getByTestId("cloud-word-secondary").dblclick();
  panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await panel.locator("[data-save-word]").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("local:2");
  expect(authority.snapshot()).toMatchObject({ wordCopyCount: 1, wordCount: 1 });

  await page.goto(`${webOrigin}/words`);
  await expect(page.getByRole("button", { name: "evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "investigation" })).toHaveCount(0);
});

test("automatic StudyCapture offers created-only current-card undo", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);

  await page.goto(`${storeFixture}?automatic`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("已加入待学习");
  await panel.locator("[data-study-capture-undo]").click();
  await expect(panel).toContainText("保存原句，稍后在 Web 深度分析");
  await expect(page.getByTestId("cloud-status")).toHaveText("undone");
  expect(authority.snapshot()).toMatchObject({ captureCount: 0 });
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "extension",
    method: "DELETE",
    path: "/v1/study-captures/capture-1",
    proof: "write-valid",
  });
});

test("an exact automatic recapture is existing and exposes no undo", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);

  await page.goto(`${storeFixture}?automatic`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  const sentence = page.getByTestId("cloud-sentence");
  await sentence.click({ clickCount: 3 });
  let panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("已加入待学习");
  await page.keyboard.press("Escape");

  await sentence.click({ clickCount: 3 });
  panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("已在 Web 中");
  await expect(panel.locator("[data-study-capture-undo]")).toHaveCount(0);
  expect(authority.snapshot()).toMatchObject({ captureCount: 1 });
});

test("a current-card undo fails closed after another page advances the capture revision", async ({
  context,
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?automatic`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const originalPanel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await originalPanel.locator('[data-action="translate"]').click();
  await expect(originalPanel).toContainText("已加入待学习");

  const secondPage = await context.newPage();
  await authority.install(secondPage);
  await secondPage.goto(`${storeFixture}?automatic&client=second`);
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-store-cloud-harness-ready",
    "true",
  );
  await secondPage.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const secondPanel = secondPage.locator("[data-huayi-store-overlay]").locator("section.panel");
  await secondPanel.locator('[data-action="translate"]').click();
  await expect(secondPanel).toContainText("已在 Web 中");

  await originalPanel.locator("[data-study-capture-undo]").click();
  await expect(originalPanel).toContainText("加入失败，可重试");
  await expect(page.getByTestId("cloud-status")).toHaveText("failed");
  expect(authority.snapshot()).toMatchObject({ captureCount: 1 });
  await secondPage.close();
});

test("an offline automatic capture reconnects through the production alarm runner", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.goto(`${storeFixture}?automatic&offline`);
  await expect(page.locator("html")).toHaveAttribute("data-store-cloud-harness-ready", "true");
  await page.getByTestId("cloud-sentence").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]").locator("section.panel");
  await panel.locator('[data-action="translate"]').click();
  await expect(panel).toContainText("待联网加入");
  await expect(page.getByTestId("cloud-status")).toHaveText("queued");
  expect(authority.snapshot()).toMatchObject({ captureCount: 0 });

  await page.getByTestId("cloud-reconnect").click();
  await expect(page.getByTestId("cloud-status")).toHaveText("submitted");
  expect(authority.snapshot()).toMatchObject({ captureCount: 1 });
  await page.goto(`${webOrigin}/app`);
  await expect(
    page.getByRole("heading", {
      name: "The investigation remained active all winter.",
      level: 2,
    }),
  ).toBeVisible();
});

test("public privacy stays API-free and a missing session never reads learning content", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "candidate-analysis",
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/privacy`);
  await expect(page.getByRole("heading", { name: "语见 Cloud V1 隐私说明" })).toBeVisible();
  await expect(
    page.getByText("BYOK Key 与该次精简结果不会发送给语见", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("平台插件查询的正文与精简结果最多保留一小时，不进入待整理或分析历史", {
      exact: false,
    }),
  ).toBeVisible();
  expect(authority.snapshot().requestFacts).toEqual([]);

  await page.goto(`${webOrigin}/app`);
  await expect(page.getByRole("heading", { name: "需要先登录" })).toBeVisible();
  const signedOutFacts = authority.snapshot().requestFacts;
  expect(signedOutFacts.length).toBeGreaterThan(0);
  expect(
    signedOutFacts.every(
      (fact) =>
        fact.authenticatedAs === "none" &&
        fact.method === "GET" &&
        fact.path === "/v1/auth/csrf" &&
        fact.proof === "read",
    ),
  ).toBe(true);
});

test("browser authority rejects missing proof and preserves strict replay semantics", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "candidate-analysis",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/privacy`);

  const status = await page.evaluate(async () => {
    const response = await fetch("https://api.huayi.invalid/v1/analyses/analysis-1/process", {
      body: JSON.stringify({ expectedRevision: 1, outcome: "nothing-to-save" }),
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    return response.status;
  });
  expect(status).toBe(403);
  expect(authority.snapshot().requestFacts.at(-1)).toEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/analyses/analysis-1/process",
    proof: "write-invalid",
  });

  const replayStatuses = await page.evaluate(
    async ({ confirmation }) => {
      const csrfResponse = await fetch("https://api.huayi.invalid/v1/auth/csrf", {
        credentials: "include",
      });
      const csrf = (await csrfResponse.json()) as { csrfToken: string };
      const headers = {
        "content-type": "application/json",
        "idempotency-key": "cloud-e2e-replay-key-000000000000",
        "if-match": '"1"',
        "x-csrf-token": csrf.csrfToken,
      };
      const submit = (body: unknown) =>
        fetch("https://api.huayi.invalid/v1/analyses/analysis-1/candidates:confirm", {
          body: JSON.stringify(body),
          credentials: "include",
          headers,
          method: "POST",
        });
      const first = await submit(confirmation);
      const replay = await submit(confirmation);
      const conflicting = await submit({
        ...confirmation,
        confirmations: confirmation.confirmations.map((candidate, index) =>
          index === 0 ? { ...candidate, tags: ["different"] } : candidate,
        ),
      });
      return [first.status, replay.status, conflicting.status];
    },
    { confirmation: contractFixtures.confirmCandidatesRequest },
  );
  expect(replayStatuses).toEqual([200, 200, 409]);

  const snapshot = authority.snapshot();
  expect(snapshot).toMatchObject({ analysisCount: 1, importCount: 0, itemCount: 1 });
  const publicEvidence = JSON.stringify(snapshot);
  for (const privateValue of [
    "cloud-e2e-csrf-token-000000000000",
    "cloud-e2e-extension-session-token-000000000000",
    "cloud-e2e-replay-key-000000000000",
    "to be frank",
  ]) {
    expect(publicEvidence).not.toContain(privateValue);
  }
});
