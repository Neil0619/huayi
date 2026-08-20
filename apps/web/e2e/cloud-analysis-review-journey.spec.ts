import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";
const sourceText = "To be frank, this works.";

test("a pasted analysis streams into Inbox and becomes a server-reread learning item", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  let startBody: unknown;
  let startProof: { csrf: string; key: string } | undefined;
  page.on("request", (request) => {
    if (request.url() === "https://api.huayi.invalid/v1/analyses:stream") {
      startBody = request.postDataJSON();
      const headers = request.headers();
      const csrf = headers["x-csrf-token"];
      const key = headers["idempotency-key"];
      if (csrf !== undefined && key !== undefined) startProof = { csrf, key };
    }
  });

  await page.goto(`${webOrigin}/analysis`);
  await expect(page.getByRole("heading", { level: 1, name: "粘贴英文分析" })).toBeVisible();
  await page.getByLabel("英文内容").fill(sourceText);
  await page.getByLabel("来源标题（可选）").fill("Writing notes");
  const streamResponse = page.waitForResponse(
    (response) => response.url() === "https://api.huayi.invalid/v1/analyses:stream",
  );
  await page.getByRole("button", { name: "开始分析" }).click();

  const response = await streamResponse;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/event-stream");
  expect(startBody).toEqual({
    selectionKind: "passage",
    source: { title: "Writing notes", type: "manual" },
    sourceText,
  });
  await expect(page.getByLabel("临时预览")).toContainText("临时预览不会保存或用于收藏");
  await expect(page.getByText("分析已完成，并已进入账号的待整理区。")).toBeVisible();

  await page.getByRole("link", { name: "前往待整理" }).click();
  await expect(page).toHaveURL(`${webOrigin}/app`);
  await page.getByRole("tab", { name: "待收藏" }).click();
  await expect(page.getByRole("heading", { level: 2, name: sourceText })).toBeVisible();
  await page.getByRole("textbox", { exact: true, name: "表达" }).fill("to be completely frank");
  await page.getByLabel("标签（逗号分隔）").fill("writing, conversation");
  await page.getByRole("button", { name: "确认所选候选" }).click();
  await expect(page.getByRole("heading", { name: "待整理箱已经清空" })).toBeVisible();

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
        fetch("https://api.huayi.invalid/v1/analyses:stream", {
          body: JSON.stringify(nextBody),
          credentials: "include",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "Idempotency-Key": proof.key,
            "X-CSRF-Token": proof.csrf,
          },
          method: "POST",
        });
      const replay = await submit(body);
      const conflict = await submit({
        ...(body as Record<string, unknown>),
        sourceText: `${(body as { sourceText: string }).sourceText} Changed.`,
      });
      return [replay.status, conflict.status];
    },
    { body: startBody, proof: startProof },
  );
  expect(replayStatuses).toEqual([200, 409]);

  const snapshot = authority.snapshot();
  expect(snapshot).toMatchObject({ analysisCount: 1, importCount: 0, itemCount: 1 });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/analyses:stream",
    proof: "write-valid",
  });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/analyses/analysis-stream-1/candidates:confirm",
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
