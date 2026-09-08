import { expect, test } from "@playwright/test";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

for (const width of [390, 1440]) {
  test(`operator error logs at ${width}px`, async ({ page }, testInfo) => {
    const authority = createCloudBrowserAuthority({
      authenticated: true,
      seed: "operator-console",
      operatorSessionNeedsVerification: true,
    });
    await page.setViewportSize({ width, height: 900 });
    await authority.install(page);
    const event = {
      version: 1,
      id: "71000000-0000-4000-8000-000000000001",
      occurredAt: "2026-09-07T05:00:00.000Z",
      source: "api",
      severity: "error",
      operation: "instant-query",
      code: "model_output_invalid",
      stage: "content-schema",
      httpStatus: 502,
      requestId: "71000000-0000-4000-8000-000000000002",
      taskId: "71000000-0000-4000-8000-000000000003",
      provider: "deepseek",
      release: "478eaf990401d63b170777c2042b5fbbdbbf71fb",
      issues: [{ path: ["candidates", "*", "ordinal"], code: "custom", rule: "candidate-order" }],
    };
    const requests: URL[] = [];
    await page.route("https://api.huayi.invalid/v1/admin/error-logs**", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const empty = url.searchParams.get("source") === "store";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": "https://web.huayi.invalid",
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify({
          items: empty
            ? []
            : [
                {
                  event,
                  userId: "71000000-0000-4000-8000-000000000004",
                  receivedAt: event.occurredAt,
                },
              ],
          nextCursor: null,
          summary: {
            events: empty ? 0 : 12,
            errors: empty ? 0 : 8,
            affectedUsers: empty ? 0 : 3,
            affectedRequests: empty ? 0 : 8,
            groups: empty
              ? []
              : [
                  {
                    source: "api",
                    operation: "instant-query",
                    code: "model_output_invalid",
                    count: 12,
                  },
                ],
          },
        }),
      });
    });
    await page.goto("https://web.huayi.invalid/admin");
    await page.getByRole("link", { name: "报错日志", exact: true }).click();
    await expect(page.getByRole("heading", { name: "报错日志", exact: true })).toBeVisible();
    await expect(page.locator(".error-log-record")).toHaveCount(1);
    await expect(page.locator("input[type='password']")).toHaveCount(0);
    await page.getByText("查看定位信息", { exact: true }).click();
    await expect(page.getByText(event.requestId, { exact: true })).toBeVisible();
    await expect(page.getByText("candidates.*.ordinal · custom · candidate-order")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`error-logs-${width}.png`), fullPage: true });
    await page.getByLabel("来源", { exact: true }).selectOption("store");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect(page.getByText(/当前范围没有收到错误日志/)).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("source")).toBe("store");
  });
}

test("a non-operator cannot enter error logs and is never asked for another password", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "password-only-sign-in-methods",
  });
  await authority.install(page);
  await page.goto("https://web.huayi.invalid/admin/error-logs");
  await expect(page.getByText("没有查看报错日志的权限", { exact: true })).toBeVisible();
  await expect(page.locator("input[type='password']")).toHaveCount(0);
  await expect(page.locator(".error-log-record")).toHaveCount(0);
  expect(
    authority
      .snapshot()
      .requestFacts.filter(
        (fact) =>
          fact.path === "/v1/admin/error-logs" || fact.path === "/v1/auth/reauthenticate/password",
      ),
  ).toEqual([]);
});
