import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors, cloudErrorBody } from "./support/cloud-browser-authority-request.js";

test("disconnects an old same-label connection after another tab refreshes login proof", async ({
  context,
  page,
}, testInfo) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  let csrfVersion = 0;
  let sessions = [1, 2, 3, 4].map((index) => ({
    createdAt: `2026-09-04T0${index}:00:00.000Z`,
    deviceLabel: "本地",
    expiresAt: "2026-12-03T00:00:00.000Z",
    id: `session-${index}`,
    lastUsedAt: index === 4 ? "2026-09-04T05:00:00.000Z" : null,
  }));
  await context.route(
    /https:\/\/api\.huayi\.invalid\/v1\/(auth\/csrf|extension-sessions)(\/.*)?$/,
    async (route) => {
      const request = route.request();
      const headers = cloudCors(request.headers().origin) ?? {};
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const path = new URL(request.url()).pathname;
      if (path === "/v1/auth/csrf") {
        csrfVersion += 1;
        await route.fulfill({
          headers,
          json: { access: "full", csrfToken: String(csrfVersion).padStart(32, "c") },
        });
      } else if (request.method() === "GET") {
        await route.fulfill({ headers, json: { items: sessions } });
      } else if (request.headers()["x-csrf-token"] !== String(csrfVersion).padStart(32, "c")) {
        await route.fulfill({ status: 403, headers, json: cloudErrorBody("forbidden") });
      } else {
        sessions = sessions.filter((session) => path !== `/v1/extension-sessions/${session.id}`);
        await route.fulfill({ status: 204, headers });
      }
    },
  );

  await page.goto("https://web.huayi.invalid/settings/devices");
  await expect(page.locator(".device-card")).toHaveCount(4);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.screenshot({ path: testInfo.outputPath("devices-narrow.png"), fullPage: true });
  const secondTab = await context.newPage();
  await secondTab.goto("https://web.huayi.invalid/settings/devices");
  await expect(secondTab.locator(".device-card")).toHaveCount(4);
  await secondTab.close();

  await page.locator('[data-request-revoke="session-1"]').click();
  await page.getByRole("button", { name: "确认断开", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已断开 本地");
  await expect(page.locator(".device-card")).toHaveCount(3);
  expect(sessions.map(({ id }) => id)).toEqual(["session-2", "session-3", "session-4"]);
  await page.reload();
  await expect(page.locator(".device-card")).toHaveCount(3);
});
