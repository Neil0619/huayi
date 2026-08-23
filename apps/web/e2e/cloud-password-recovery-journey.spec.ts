import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const apiOrigin = "https://api.huayi.invalid";
const mailOrigin = "https://mail.huayi.invalid";
const webOrigin = "https://web.huayi.invalid";
const recoveryCookieUrl = `${apiOrigin}/v1/auth/password/recovery/session`;
const email = "recovery-learner@example.com";
const oldPassword = "original horse battery staple";
const newPassword = "replacement horse battery staple";

test("a learner completes password recovery only through the latest confirmed mail", async ({
  browser,
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "password-recovery",
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/login`);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(`${webOrigin}/recover`);
  await expect(page.getByRole("heading", { level: 1, name: "恢复密码" })).toBeVisible();

  for (let index = 0; index < 2; index += 1) {
    await page.getByLabel("邮箱").fill(email);
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.url() === `${apiOrigin}/v1/auth/password/recovery` &&
          candidate.request().method() === "POST",
      ),
      page.getByRole("button", { name: "发送恢复邮件" }).click(),
    ]);
    expect(response.status()).toBe(202);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    await expect(page.getByRole("status")).toContainText("如果该邮箱可恢复");
    await expect(page.getByLabel("邮箱")).toHaveValue("");
  }
  expect(
    (await page.context().cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);

  const staleContext = await browser.newContext({
    // Route-fulfilled HTTPS documents have an opaque origin, so Chromium cannot match CSP 'self'.
    // The response header is asserted below; bypass only lets the same-origin form reach the fake API.
    bypassCSP: true,
    reducedMotion: "reduce",
    viewport: { height: 844, width: 390 },
  });
  const stalePage = await staleContext.newPage();
  await authority.install(stalePage);
  await stalePage.goto(`${mailOrigin}/inbox`);
  await expect(stalePage.getByRole("button", { name: "打开第 1 封恢复邮件" })).toBeVisible();
  const [staleConfirm] = await Promise.all([
    stalePage.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/v1/auth/password/recovery/confirm?`) &&
        response.request().method() === "GET",
    ),
    stalePage.getByRole("button", { name: "打开第 1 封恢复邮件" }).click(),
  ]);
  expect(staleConfirm.headers()).toMatchObject({
    "cache-control": "private, no-store",
    "content-security-policy":
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  });
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "none",
    method: "GET",
    path: "/v1/auth/password/recovery/confirm",
    proof: "read",
  });
  expect(
    (await staleContext.cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);
  await expect(stalePage.getByRole("heading", { level: 1, name: "继续重置密码" })).toBeVisible();
  await stalePage.getByRole("button", { name: "继续重置密码" }).click();
  await expect(stalePage).toHaveURL(`${webOrigin}/recover`);
  await expect(stalePage.getByRole("alert")).toContainText("恢复链接无效或已过期");
  expect(
    (await staleContext.cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);
  await staleContext.close();

  const recoveryContext = await browser.newContext({
    bypassCSP: true,
    reducedMotion: "reduce",
    viewport: { height: 844, width: 390 },
  });
  const recoveryPage = await recoveryContext.newPage();
  await authority.install(recoveryPage);
  await recoveryPage.goto(`${mailOrigin}/inbox`);
  const [confirmResponse] = await Promise.all([
    recoveryPage.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/v1/auth/password/recovery/confirm?`) &&
        response.request().method() === "GET",
    ),
    recoveryPage.getByRole("button", { name: "打开第 2 封恢复邮件" }).click(),
  ]);
  expect(confirmResponse.status()).toBe(200);
  expect(authority.snapshot().securityNotificationCount).toBe(0);
  expect(
    authority
      .snapshot()
      .requestFacts.filter((fact) => fact.path === "/v1/auth/password/recovery/callback"),
  ).toHaveLength(1);
  expect(
    (await recoveryContext.cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);

  const [callbackResponse] = await Promise.all([
    recoveryPage.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/recovery/callback` &&
        response.request().method() === "POST",
    ),
    recoveryPage.getByRole("button", { name: "继续重置密码" }).click(),
  ]);
  expect(callbackResponse.status()).toBe(302);
  await expect(recoveryPage).toHaveURL(`${webOrigin}/recover`);
  await expect(recoveryPage.getByRole("heading", { level: 1, name: "设置新密码" })).toBeFocused();
  const recoveryCookie = (await recoveryContext.cookies(recoveryCookieUrl)).find(
    (candidate) => candidate.name === "huayi_password_recovery",
  );
  expect(recoveryCookie).toMatchObject({
    httpOnly: true,
    path: "/v1/auth/password/recovery",
    sameSite: "Lax",
    secure: true,
  });

  const passwordInput = recoveryPage.getByLabel("新密码", { exact: true });
  const confirmationInput = recoveryPage.getByLabel("再次输入新密码");
  await expect(passwordInput).toHaveAttribute("autocomplete", "new-password");
  await expect(confirmationInput).toHaveAttribute("autocomplete", "new-password");
  await passwordInput.fill(newPassword);
  await confirmationInput.fill("different replacement password");
  const completeFactsBeforeMismatch = authority
    .snapshot()
    .requestFacts.filter((fact) => fact.path === "/v1/auth/password/recovery/complete").length;
  await recoveryPage.getByRole("button", { name: "更新密码" }).click();
  await expect(recoveryPage.getByRole("alert")).toContainText("两次输入的密码不一致");
  expect(
    authority
      .snapshot()
      .requestFacts.filter((fact) => fact.path === "/v1/auth/password/recovery/complete").length,
  ).toBe(completeFactsBeforeMismatch);
  await expect(passwordInput).toHaveValue(newPassword);

  await confirmationInput.fill(newPassword);
  const [completeResponse] = await Promise.all([
    recoveryPage.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/recovery/complete` &&
        response.request().method() === "POST",
    ),
    recoveryPage.getByRole("button", { name: "更新密码" }).click(),
  ]);
  expect(completeResponse.status()).toBe(204);
  expect(completeResponse.headers()["cache-control"]).toBe("private, no-store");
  await expect(recoveryPage).toHaveURL(`${webOrigin}/login`);
  expect(
    (await recoveryContext.cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);
  expect(
    (await recoveryContext.cookies(apiOrigin)).some(
      (candidate) => candidate.name === "huayi_session",
    ),
  ).toBe(false);
  expect(authority.snapshot()).toMatchObject({
    extensionSessionCount: 0,
    securityNotificationCount: 1,
    webSessionCount: 0,
  });

  const loginEmail = recoveryPage.getByLabel("邮箱");
  const loginPassword = recoveryPage.getByLabel("密码");
  await loginEmail.fill(email);
  await loginPassword.fill(oldPassword);
  const [oldLoginResponse] = await Promise.all([
    recoveryPage.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/login` &&
        response.request().method() === "POST",
    ),
    recoveryPage.getByRole("button", { name: "登录", exact: true }).click(),
  ]);
  expect(oldLoginResponse.status()).toBe(401);
  await expect(recoveryPage.getByRole("alert")).toContainText("请检查邮箱和密码后重试");
  expect(
    (await recoveryContext.cookies(apiOrigin)).some(
      (candidate) => candidate.name === "huayi_session",
    ),
  ).toBe(false);

  await loginPassword.fill(newPassword);
  const [newLoginResponse] = await Promise.all([
    recoveryPage.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/login` &&
        response.request().method() === "POST",
    ),
    recoveryPage.getByRole("button", { name: "登录", exact: true }).click(),
  ]);
  expect(newLoginResponse.status()).toBe(200);
  await expect(recoveryPage).toHaveURL(`${webOrigin}/practice`);
  await expect(recoveryPage.getByRole("heading", { level: 1, name: "今日练习" })).toBeVisible();
  await expect(recoveryPage.getByRole("heading", { name: "今天没有待练习内容" })).toBeVisible();
  expect(authority.snapshot().webSessionCount).toBe(1);

  const replayContext = await browser.newContext({
    bypassCSP: true,
    reducedMotion: "reduce",
    viewport: { height: 844, width: 390 },
  });
  const replayPage = await replayContext.newPage();
  await authority.install(replayPage);
  await replayPage.goto(`${mailOrigin}/inbox`);
  await replayPage.getByRole("button", { name: "打开第 2 封恢复邮件" }).click();
  await expect(replayPage.getByRole("heading", { level: 1, name: "继续重置密码" })).toBeVisible();
  await replayPage.getByRole("button", { name: "继续重置密码" }).click();
  await expect(replayPage).toHaveURL(`${webOrigin}/recover`);
  await expect(replayPage.getByRole("alert")).toContainText("恢复链接无效或已过期");
  expect(
    (await replayContext.cookies(recoveryCookieUrl)).some(
      (candidate) => candidate.name === "huayi_password_recovery",
    ),
  ).toBe(false);
  expect(authority.snapshot()).toMatchObject({
    securityNotificationCount: 1,
    webSessionCount: 1,
  });
  await replayContext.close();

  const publicEvidence = JSON.stringify(authority.snapshot());
  for (const privateValue of [
    email,
    oldPassword,
    newPassword,
    recoveryCookie?.value,
    "flow",
    "code",
    "cloud-e2e-password-recovery-csrf-0000000",
    "cloud-e2e-password-recovery-login-csrf",
    "huayi_password_recovery",
  ]) {
    if (privateValue !== undefined) expect(publicEvidence).not.toContain(privateValue);
  }
  expect(await recoveryPage.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([
    0, 0,
  ]);
  expect(
    await recoveryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await recoveryContext.close();
});
