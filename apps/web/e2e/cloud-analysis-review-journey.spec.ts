import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";
const sourceText = "To be frank, this works.";

test("a pasted original streams through a durable task and becomes a server-reread learning item", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "empty",
    holdLearningTasks: true,
  });
  await authority.install(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  let startBody: unknown;
  let startProof: { csrf: string; key: string } | undefined;
  page.on("request", (request) => {
    if (
      request.url() === "https://api.huayi.invalid/v2/learning-tasks" &&
      request.method() === "POST"
    ) {
      startBody = request.postDataJSON();
      const headers = request.headers();
      const csrf = headers["x-csrf-token"];
      const key = headers["idempotency-key"];
      if (csrf !== undefined && key !== undefined) startProof = { csrf, key };
    }
  });

  await page.goto(`${webOrigin}/analysis`);
  await expect(page.getByRole("heading", { level: 1, name: "收集箱" })).toBeVisible();
  await page.getByLabel("想学习的英文原文").fill(sourceText);
  await page.getByLabel("内容类型").selectOption("passage");
  await page.getByText("添加标题与学习上下文（可选）", { exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("Writing notes");
  const streamResponse = page.waitForResponse(
    (response) =>
      response.url() === "https://api.huayi.invalid/v2/learning-tasks" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "保存并开始分析" }).click();

  const response = await streamResponse;
  expect(response.status()).toBe(202);
  expect(startBody).toEqual({
    version: 2,
    kind: "capture-analysis",
    captureId: "capture-1",
    input: { expectedRevision: 2, intent: "initial" },
  });
  await expect(page.getByLabel("实时分析预览")).toContainText("正在识别可复用表达。");
  expect(authority.snapshot()).toMatchObject({ captureCount: 1, analysisCount: 0, itemCount: 0 });
  authority.completeLearningTasks();
  await expect(page.getByText("分析已完成，请选择要练习的表达或句型。")).toBeVisible();

  await page.goto(`${webOrigin}/app`);
  await expect(page).toHaveURL(`${webOrigin}/app`);
  await expect(page.getByRole("heading", { level: 2, name: sourceText })).toBeVisible();
  await page.getByText("编辑内容与标签", { exact: true }).click();
  await page.getByRole("textbox", { exact: true, name: "表达" }).fill("to be completely frank");
  await page.getByLabel("标签（逗号分隔）").fill("writing, conversation");
  await page.getByRole("button", { name: "加入学习库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "已整理到学习库" })).toBeVisible();

  await page.locator(".workspace-navigation > summary").click();
  await page.getByRole("link", { name: "学习库" }).click();
  const item = page.getByRole("button", { name: /to be completely frank/u });
  await expect(item).toBeVisible();
  await item.click();
  const detailHeading = page.getByRole("heading", { level: 2, name: "to be completely frank" });
  await expect(detailHeading).toBeFocused();
  await expect(page.getByRole("heading", { level: 3, name: "来源示例" })).toBeVisible();
  await expect(page.getByText("Writing notes", { exact: true })).toBeVisible();
  await expect(page.getByText(sourceText, { exact: true })).toBeVisible();

  if (startProof === undefined) throw new Error("Analysis write proof was not captured.");
  const replayStatuses = await page.evaluate(
    async ({ body, proof }) => {
      const submit = (nextBody: unknown) =>
        fetch("https://api.huayi.invalid/v2/learning-tasks", {
          body: JSON.stringify(nextBody),
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": proof.key,
            "X-CSRF-Token": proof.csrf,
          },
          method: "POST",
        });
      const replay = await submit(body);
      const conflict = await submit({
        ...(body as Record<string, unknown>),
        captureId: "capture-changed",
      });
      return [replay.status, conflict.status];
    },
    { body: startBody, proof: startProof },
  );
  expect(replayStatuses).toEqual([202, 409]);

  const snapshot = authority.snapshot();
  expect(snapshot).toMatchObject({ analysisCount: 1, importCount: 0, itemCount: 1 });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v2/learning-tasks",
    proof: "write-valid",
  });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/analyses/analysis-capture-1/candidates:confirm",
    proof: "write-valid",
  });
  const publicSnapshot = JSON.stringify(snapshot);
  expect(publicSnapshot).not.toContain(sourceText);
  expect(publicSnapshot).not.toContain("to be completely frank");
  expect(publicSnapshot).not.toContain("cloud-e2e-csrf-token");
  expect(
    await page.evaluate(() => ({
      local: Object.keys(localStorage),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      session: Object.keys(sessionStorage),
    })),
  ).toEqual({ local: [], overflow: false, session: [] });
});
