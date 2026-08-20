import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const invitationToken = "operator-invitation-token-00000001";
const learnerEmail = "learner@example.test";
const webOrigin = "https://web.huayi.invalid";

test("an operator manages metadata through the actual console", async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "operator-console",
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "运营控制台", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前 UTC 月运营概览" })).toBeVisible();
  await expect(page.getByText(learnerEmail)).toBeVisible();
  await expect(page.getByRole("heading", { name: "邀请" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "无正文审计" })).toBeVisible();

  await page.getByLabel("邮箱搜索").fill("LEARNER");
  await page.getByRole("button", { name: "筛选账号" }).click();
  await expect(page.getByText(learnerEmail)).toBeVisible();
  await expect(page.getByText("operator@example.test")).toHaveCount(0);

  await page.getByRole("button", { name: "停用账号" }).click();
  const disable = page.getByRole("button", { name: `确认停用 ${learnerEmail}` });
  await expect(disable).toBeFocused();
  await disable.click();
  await expect(page.getByText("账号已停用，并撤销其登录与扩展访问。")).toBeVisible();

  await page.getByRole("button", { name: "创建邀请" }).click();
  await expect(page.locator("output")).toHaveText(`/join#${invitationToken}`);
  await page.getByRole("button", { name: "启用模型熔断" }).click();
  const stopModel = page.getByRole("button", { name: "确认停止平台模型请求" });
  await expect(stopModel).toBeFocused();
  await stopModel.click();
  await expect(page.getByText("平台模型请求已停止。浏览与 BYOK 不受影响。")).toBeVisible();

  const snapshot = authority.snapshot();
  for (const [method, path] of [
    ["POST", "/v1/admin/users/00000000-0000-0000-0000-000000000002/status"],
    ["POST", "/v1/admin/invitations"],
    ["PUT", "/v1/admin/runtime/model-kill-switch"],
  ] as const) {
    expect(snapshot.requestFacts).toContainEqual({
      authenticatedAs: "web",
      method,
      path,
      proof: "write-valid",
    });
  }
  expect(JSON.stringify(snapshot)).not.toContain(invitationToken);

  await page.reload();
  await expect(page.getByRole("button", { name: "关闭模型熔断" })).toBeVisible();
  await expect(page.getByText(learnerEmail)).toBeVisible();
  await expect(page.locator(".admin-status-disabled")).toContainText("disabled");
  await expect(page.getByText("user.disabled")).toBeVisible();
  await expect(page.getByText("model.kill-switch-set")).toBeVisible();
  expect(await page.locator("body").textContent()).not.toContain(invitationToken);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a signed-in non-operator is denied before admin metadata loads", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  const accessStatuses: number[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/v1/admin/access") {
      accessStatuses.push(response.status());
    }
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/admin`);
  await expect(page.getByRole("heading", { name: "无法进入运营控制台" })).toBeVisible();
  expect(accessStatuses.length).toBeGreaterThan(0);
  expect(accessStatuses.every((status) => status === 403)).toBe(true);
  await expect(page.getByText(learnerEmail)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "创建邀请" })).toHaveCount(0);
  const adminFacts = authority
    .snapshot()
    .requestFacts.filter((fact) => fact.path.startsWith("/v1/admin/"));
  expect(adminFacts.length).toBeGreaterThan(0);
  expect(
    adminFacts.every(
      ({ method, path, proof }) =>
        method === "GET" && path === "/v1/admin/access" && proof === "read",
    ),
  ).toBe(true);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
