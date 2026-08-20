import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";

test("an invited learner completes Google registration and creates a learning item", async ({
  page,
}) => {
  const invitationToken = "i".repeat(32);
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "invitation-onboarding",
  });
  const documentRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document" && request.url().startsWith(webOrigin)) {
      documentRequests.push(request.url());
    }
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/join#${invitationToken}`);
  await expect(page.getByRole("heading", { name: "接受学习邀请" })).toBeVisible();
  await expect(page.getByText("邀请已验证。选择一种方式创建账号。")).toBeVisible();
  await expect(page).toHaveURL(`${webOrigin}/join`);
  expect(documentRequests[0]).toBe(`${webOrigin}/join`);
  expect(
    authority.snapshot().requestFacts.filter((fact) => fact.path === "/v1/invitations/claim"),
  ).toHaveLength(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.locator("body").textContent()).not.toContain(invitationToken);

  await page.getByRole("button", { name: "使用 Google 继续" }).click();
  await expect(page).toHaveURL(/https:\/\/accounts\.google\.invalid\/consent\?flow=/u);
  expect(page.url()).not.toContain(invitationToken);
  expect(page.url()).not.toContain("claimTicket");
  await expect(page.getByRole("heading", { name: "测试 Google 账号" })).toBeVisible();
  await page.getByRole("button", { name: "以测试账号继续" }).click();

  await expect(page).toHaveURL(`${webOrigin}/app`);
  await expect(page.getByRole("heading", { name: "待分析", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "还没有待分析内容" })).toBeVisible();
  await page.locator(".workspace-navigation > summary").click();
  await page.getByRole("link", { name: "学习库" }).click();
  await expect(page).toHaveURL(`${webOrigin}/library`);
  await expect(page.getByRole("heading", { name: "当前筛选下没有学习项" })).toBeVisible();

  await page.getByLabel("英文表达").fill("in practical terms");
  await page.getByLabel("中文含义").fill("从实际角度来说");
  await page.getByLabel("中文用法").fill("用于把抽象讨论转向现实影响。");
  await page.getByLabel("标签（逗号分隔）").fill("writing, planning");
  await page.getByRole("button", { name: "收录到学习库" }).click();

  const detailHeading = page.locator(".library-detail h2");
  await expect(detailHeading).toHaveText("in practical terms");
  await expect(detailHeading).toBeFocused();
  await expect(page.getByText("已收录并从学习库重新载入。详情已打开。")).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const snapshot = authority.snapshot();
  expect(snapshot).toMatchObject({ itemCount: 1 });
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: "/v1/learning-items",
    proof: "write-valid",
  });
  for (const expected of [
    { authenticatedAs: "none", method: "POST", path: "/v1/invitations/claim" },
    { authenticatedAs: "none", method: "POST", path: "/v1/auth/google/start" },
    { authenticatedAs: "none", method: "GET", path: "/v1/auth/callback" },
  ] as const) {
    expect(snapshot.requestFacts).toContainEqual({ ...expected, proof: "write-valid" });
  }
  const publicEvidence = JSON.stringify(snapshot);
  for (const privateValue of [
    invitationToken,
    "in practical terms",
    "learner@example.com",
    "claimTicket",
    "huayi_session",
  ]) {
    expect(publicEvidence).not.toContain(privateValue);
  }
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  const repeatedClaimStatus = await page.evaluate(async (token) => {
    const response = await fetch("https://api.huayi.invalid/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: token }),
      headers: { "content-type": "application/json" },
      method: "POST",
      referrerPolicy: "no-referrer",
    });
    return response.status;
  }, invitationToken);
  expect(repeatedClaimStatus).toBe(409);
});
