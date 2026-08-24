import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const apiOrigin = "https://api.huayi.invalid";
const mailOrigin = "https://mail.huayi.invalid";
const webOrigin = "https://web.huayi.invalid";

test("a provider-authenticated password cannot bypass the Huayi method fence", async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "unregistered-password-login",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/login`);
  await page.getByLabel("邮箱").fill("password-learner@example.com");
  await page.getByLabel("密码").fill("correct horse battery staple");

  const [response] = await Promise.all([
    page.waitForResponse(`${apiOrigin}/v1/auth/password/login`),
    page.getByRole("button", { name: "登录", exact: true }).click(),
  ]);

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByRole("alert")).toContainText("请检查邮箱和密码后重试");
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "none",
    method: "POST",
    path: "/v1/auth/password/login",
    proof: "write-valid",
  });
});

test("an invited learner confirms password registration and later signs in again", async ({
  page,
}) => {
  const invitationToken = "i".repeat(32);
  const email = "password-learner@example.com";
  const password = "correct horse battery staple";
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "password-authentication",
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
  await expect(page.getByRole("heading", { name: "接受学习邀请", level: 1 })).toBeVisible();
  await expect(page.getByText("邀请已验证。选择一种方式创建账号。")).toBeVisible();
  await expect(page).toHaveURL(`${webOrigin}/join`);
  expect(documentRequests[0]).toBe(`${webOrigin}/join`);

  await page.getByLabel("邮箱").fill(email);
  const registrationPassword = page.getByLabel("密码");
  await expect(registrationPassword).toHaveAttribute("autocomplete", "new-password");
  await expect(registrationPassword).toHaveAttribute("minlength", "12");
  await registrationPassword.fill(password);
  const [registrationResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/register` &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "使用邮箱注册" }).click(),
  ]);

  expect(registrationResponse.status()).toBe(202);
  expect(registrationResponse.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.getByRole("status")).toContainText("输入邮件中的六位验证码");
  await expect(page).toHaveURL(`${webOrigin}/join`);
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);

  const [resendResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/register/resend` &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "重新发送六位验证码" }).click(),
  ]);
  expect(resendResponse.status()).toBe(202);
  expect(resendResponse.headers()["cache-control"]).toBe("private, no-store");
  expect(resendResponse.headers()["set-cookie"]).toBeUndefined();
  await expect(page.getByRole("status")).toContainText("只使用最新邮件中的验证码");
  await expect
    .poll(() =>
      page.evaluate(
        (url) => fetch(url).then((response) => response.status),
        `${apiOrigin}/v1/auth/password/confirm?flow=${"f".repeat(43)}`,
      ),
    )
    .toBe(404);

  await page.goto(`${mailOrigin}/inbox`);
  await expect(page.getByRole("heading", { name: "测试邮箱确认", level: 1 })).toBeVisible();
  const [confirmationResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/password/confirm" &&
        response.request().method() === "GET",
    ),
    page.getByRole("link", { name: "打开确认页" }).click(),
  ]);
  expect(confirmationResponse.status()).toBe(200);
  expect(confirmationResponse.headers()["cache-control"]).toBe("private, no-store");
  expect(confirmationResponse.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "确认语见邮箱", level: 1 })).toBeVisible();
  await page.reload();
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("六位验证码").fill("654321");
  const [callbackResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/auth/password/callback" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "确认邮箱并继续" }).click(),
  ]);

  await expect(page).toHaveURL(`${webOrigin}/practice`);
  expect(callbackResponse.headers()["cache-control"]).toBe("private, no-store");
  expect(callbackResponse.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "今日练习", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天没有待练习内容" })).toBeVisible();
  const registrationCookie = (await page.context().cookies(apiOrigin)).find(
    (cookie) => cookie.name === "huayi_session",
  );
  expect(registrationCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: true });

  await page.context().clearCookies();
  await page.goto(`${webOrigin}/login`);
  await expect(page.getByRole("heading", { name: "登录语见", level: 1 })).toBeVisible();
  const loginEmail = page.getByLabel("邮箱");
  const loginPassword = page.getByLabel("密码");
  await expect(loginPassword).toHaveAttribute("autocomplete", "current-password");
  await loginEmail.fill(email);
  await loginPassword.fill("wrong password long enough");
  const [rejectedLogin] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/login` &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "登录", exact: true }).click(),
  ]);
  expect(rejectedLogin.status()).toBe(401);
  expect(rejectedLogin.headers()["cache-control"]).toBe("private, no-store");
  await expect(page.getByRole("alert")).toContainText("请检查邮箱和密码后重试");
  await expect(loginEmail).toHaveValue(email);
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);

  await loginPassword.fill(password);
  const [acceptedLogin] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/password/login` &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "登录", exact: true }).click(),
  ]);
  expect(acceptedLogin.status()).toBe(200);
  expect(acceptedLogin.headers()["cache-control"]).toBe("private, no-store");
  await expect(page).toHaveURL(`${webOrigin}/practice`);
  await expect(page.getByRole("heading", { name: "今日练习", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天没有待练习内容" })).toBeVisible();
  const loginCookie = (await page.context().cookies(apiOrigin)).find(
    (cookie) => cookie.name === "huayi_session",
  );
  expect(loginCookie).toMatchObject({ httpOnly: true, sameSite: "Lax", secure: true });
  expect(loginCookie?.value).not.toBe(registrationCookie?.value);

  const snapshot = authority.snapshot();
  for (const expected of [
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/invitations/claim",
      proof: "write-valid",
    },
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/auth/password/register",
      proof: "write-valid",
    },
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/auth/password/register/resend",
      proof: "write-valid",
    },
    {
      authenticatedAs: "none",
      method: "GET",
      path: "/v1/auth/password/confirm",
      proof: "read",
    },
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/auth/password/callback",
      proof: "write-valid",
    },
  ] as const) {
    expect(snapshot.requestFacts).toContainEqual(expected);
  }
  expect(
    snapshot.requestFacts.filter(
      (fact) => fact.method === "POST" && fact.path === "/v1/auth/password/login",
    ),
  ).toEqual([
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/auth/password/login",
      proof: "write-valid",
    },
    {
      authenticatedAs: "none",
      method: "POST",
      path: "/v1/auth/password/login",
      proof: "write-valid",
    },
  ]);
  const csrfFacts = snapshot.requestFacts.filter(
    (fact) => fact.method === "GET" && fact.path === "/v1/auth/csrf",
  );
  expect(csrfFacts.length).toBeGreaterThanOrEqual(2);
  expect(csrfFacts).toEqual(
    csrfFacts.map(() => ({
      authenticatedAs: "web",
      method: "GET",
      path: "/v1/auth/csrf",
      proof: "read",
    })),
  );
  const publicEvidence = JSON.stringify(snapshot);
  for (const privateValue of [invitationToken, email, password, "claimTicket", "huayi_session"]) {
    expect(publicEvidence).not.toContain(privateValue);
  }
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
