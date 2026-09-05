import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";

test("actual Web bundle suggests, previews, and explicitly confirms a server-reread merge", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "semantic-duplicate-suggestions",
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/library`);
  await expect(page.getByRole("heading", { name: "学习项 2" })).toBeVisible();
  await page.getByRole("button", { name: /frankly speaking/u }).click();
  await page.getByRole("button", { name: "查找语义重复" }).click();
  await expect(page.getByRole("heading", { name: "语义重复候选" })).toBeVisible();
  await expect(page.getByText("语义用途接近。")).toBeVisible();

  expect(authority.snapshot().itemCount).toBe(2);
  expect(authority.snapshot().duplicateSuggestionProviderCallCount).toBe(1);
  await expect(page.getByRole("heading", { name: "合并预览" })).toHaveCount(0);
  await page.getByRole("button", { name: "预览合并" }).click();
  await expect(page.getByRole("heading", { name: "合并预览" })).toBeVisible();
  expect(authority.snapshot().itemCount).toBe(2);

  await page.getByRole("button", { name: "确认合并并删除来源" }).click();
  await expect(page.getByRole("heading", { name: "学习项 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "to be frank", level: 2 })).toBeFocused();
  expect(authority.snapshot().itemCount).toBe(1);
  expect(authority.snapshot().requestFacts).toEqual(
    expect.arrayContaining([
      {
        authenticatedAs: "web",
        method: "POST",
        path: "/v2/learning-tasks",
        proof: "write-valid",
      },
      {
        authenticatedAs: "web",
        method: "POST",
        path: "/v1/learning-items/item-source/merge:preview",
        proof: "write-valid",
      },
      {
        authenticatedAs: "web",
        method: "POST",
        path: "/v1/learning-items/item-source/merge:confirm",
        proof: "write-valid",
      },
      {
        authenticatedAs: "web",
        method: "GET",
        path: "/v1/learning-items/item-target",
        proof: "read",
      },
    ]),
  );
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  const publicEvidence = JSON.stringify(authority.snapshot());
  for (const privateValue of [
    "frankly speaking",
    "to be frank",
    "learning-duplicate-suggestions-v1",
    "raw output",
    "reservation",
    "practice_generation_tasks",
  ]) {
    expect(publicEvidence).not.toContain(privateValue);
  }
});
