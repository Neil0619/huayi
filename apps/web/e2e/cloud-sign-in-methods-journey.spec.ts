import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";

test("password account links Google through recent authentication in the actual Web bundle", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "password-only-sign-in-methods",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/settings/account`);

  await expect(page.getByText("密码已绑定", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加 Google 登录" }).click();
  const password = page.getByLabel("当前密码");
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await password.fill("correct horse battery staple");
  await page.getByRole("button", { name: "确认并前往 Google" }).click();
  await expect(page.getByRole("heading", { name: "测试 Google 账号" })).toBeVisible();
  await page.getByRole("button", { name: "以测试账号继续" }).click();

  await expect(page).toHaveURL(`${webOrigin}/settings/account`);
  await expect(page.getByText("Google 已绑定", { exact: true })).toBeVisible();
  expect(authority.snapshot().requestFacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: "POST", path: "/v1/auth/reauthenticate/password" }),
      expect.objectContaining({
        method: "POST",
        path: "/v1/account/sign-in-methods/google:start",
      }),
    ]),
  );
});

test("Google account reauthenticates then links a password in the actual Web bundle", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "google-only-sign-in-methods",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/settings/account`);

  await page.getByRole("button", { name: "通过 Google 确认身份" }).click();
  await expect(page.getByRole("heading", { name: "测试 Google 账号" })).toBeVisible();
  await page.getByRole("button", { name: "以测试账号继续" }).click();
  await expect(page).toHaveURL(`${webOrigin}/settings/account`);

  const password = page.getByLabel("新密码");
  await expect(password).toHaveAttribute("autocomplete", "new-password");
  await password.fill("correct horse battery staple");
  await page.getByRole("button", { name: "绑定密码" }).click();
  await expect(page.getByText("密码已绑定", { exact: true })).toBeVisible();
  await expect(
    page.getByText("密码登录方式已绑定，其他会话已退出。", { exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("correct horse battery staple");
});

test("a stale password-link view rereads canonical methods after the method was already linked", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "stale-password-sign-in-methods",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/settings/account`);

  await page.getByRole("button", { name: "通过 Google 确认身份" }).click();
  await expect(page.getByRole("heading", { name: "测试 Google 账号" })).toBeVisible();
  await page.getByRole("button", { name: "以测试账号继续" }).click();
  await expect(page).toHaveURL(`${webOrigin}/settings/account`);

  await page.getByLabel("新密码").fill("correct horse battery staple");
  await page.getByRole("button", { name: "绑定密码" }).click();
  await expect(page.getByText("密码登录方式已经绑定，页面已刷新。", { exact: true })).toBeVisible();
  await expect(page.getByText("密码已绑定", { exact: true })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("correct horse battery staple");
  expect(authority.snapshot().requestFacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "POST",
        path: "/v1/account/sign-in-methods/password",
        proof: "write-valid",
      }),
    ]),
  );
});
