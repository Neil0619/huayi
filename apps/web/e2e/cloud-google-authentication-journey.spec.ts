import { expect, test, type Page } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import type { CloudBrowserAuthority } from "./support/cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const providerOrigin = "https://accounts.google.invalid";
const webOrigin = "https://web.huayi.invalid";

async function openProvider(page: Page, authority: CloudBrowserAuthority) {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);
  await page.goto(`${webOrigin}/login`);
  const [start] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${apiOrigin}/v1/auth/google/login/start` &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "使用 Google 登录" }).click(),
  ]);
  expect(start.status()).toBe(302);
  expect(start.headers()["cache-control"]).toBe("private, no-store");
  expect(start.headers()["set-cookie"]).toBeUndefined();
  expect(start.request().postData() ?? "").toBe("");
  expect(start.request().headers()["content-type"]).toContain("application/x-www-form-urlencoded");
  await expect(page).toHaveURL(new RegExp(`^${providerOrigin}/consent\\?flow=`));
  await expect(page.getByRole("heading", { level: 1, name: "测试 Google 登录" })).toBeVisible();
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);
}

test("an active existing Google account signs in through the production Web form", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "google-authentication",
  });
  const appDocumentReferers: (string | undefined)[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document" && request.url() === `${webOrigin}/app`) {
      appDocumentReferers.push(request.headers().referer);
    }
  });
  await openProvider(page, authority);

  const [callback] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/v1/auth/callback?`) &&
        response.request().method() === "GET",
    ),
    page.getByRole("button", { name: "以测试账号继续" }).click(),
  ]);
  expect(callback.status()).toBe(302);
  expect(callback.headers()["cache-control"]).toBe("private, no-store");
  expect(callback.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL(`${webOrigin}/app`);
  await expect(page.getByRole("heading", { level: 1, name: "待分析" })).toBeVisible();
  expect(appDocumentReferers).toEqual([undefined]);
  const sessionCookie = (await page.context().cookies(apiOrigin)).find(
    (cookie) => cookie.name === "huayi_session",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
  expect(authority.snapshot().webSessionCount).toBe(1);
  for (const expected of [
    { authenticatedAs: "none", method: "POST", path: "/v1/auth/google/login/start" },
    { authenticatedAs: "none", method: "GET", path: "/v1/auth/callback" },
  ] as const) {
    expect(authority.snapshot().requestFacts).toContainEqual({
      ...expected,
      proof: "write-valid",
    });
  }
  const publicEvidence = JSON.stringify(authority.snapshot());
  for (const privateValue of [
    sessionCookie?.value,
    "cloud-e2e-google-login-flow",
    "cloud-e2e-google-login-code",
    "cloud-e2e-google-login-csrf",
    "google-learner@example.com",
    "provider-user",
  ]) {
    if (privateValue !== undefined) expect(publicEvidence).not.toContain(privateValue);
  }
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a disabled Google account receives only a data-rights session", async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "disabled-google-authentication",
  });
  await openProvider(page, authority);

  const [callback] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/v1/auth/callback?`) &&
        response.request().method() === "GET",
    ),
    page.getByRole("button", { name: "以测试账号继续" }).click(),
  ]);
  expect(callback.status()).toBe(302);
  expect(callback.headers()["cache-control"]).toBe("private, no-store");
  expect(callback.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL(`${webOrigin}/settings/data`);
  await expect(page.getByRole("heading", { level: 1, name: "导出与永久删除" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "待分析" })).toHaveCount(0);
  expect(authority.snapshot().webSessionCount).toBe(1);
});

test("a provider identity without the registered Google method creates no Huayi session", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: false,
    seed: "unregistered-google-authentication",
  });
  await openProvider(page, authority);

  const [callback] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().startsWith(`${apiOrigin}/v1/auth/callback?`) &&
        response.request().method() === "GET",
    ),
    page.getByRole("button", { name: "以测试账号继续" }).click(),
  ]);
  expect(callback.status()).toBe(401);
  expect(callback.headers()["cache-control"]).toBe("private, no-store");
  expect(callback.headers()["referrer-policy"]).toBe("no-referrer");
  expect(callback.headers()["set-cookie"]).toBeUndefined();
  await expect(page.locator("body")).toContainText("authentication_required");
  expect(
    (await page.context().cookies(apiOrigin)).some((cookie) => cookie.name === "huayi_session"),
  ).toBe(false);
  expect(authority.snapshot().webSessionCount).toBe(0);
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "none",
    method: "GET",
    path: "/v1/auth/callback",
    proof: "write-invalid",
  });
  expect(JSON.stringify(authority.snapshot())).not.toContain("google-learner@example.com");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
