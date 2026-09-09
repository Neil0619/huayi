import { expect, test } from "@playwright/test";
import { miniProgramBindingApprovalSchema } from "@huayi/cloud-contracts";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";
for (const width of [390, 1280])
  test(`WeChat binding has explicit account confirmation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const authority = createCloudBrowserAuthority({
      authenticated: true,
      seed: "password-only-sign-in-methods",
    });
    await authority.install(page);
    let approvals = 0;
    await page.route("https://api.huayi.invalid/v1/auth/wechat/binding/approve", async (route) => {
      const request = route.request();
      const headers = cloudCors(request.headers()["origin"]) ?? {};
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      expect(miniProgramBindingApprovalSchema.parse(request.postDataJSON())).toEqual({
        bindingCode: "ABCD012345",
        confirmed: true,
      });
      approvals++;
      await route.fulfill({ status: 204, headers });
    });
    await page.goto("https://web.huayi.invalid/settings/account");
    const panel = page.getByRole("region", { name: "微信小程序关联" });
    await panel.getByLabel("小程序一次性绑定码").fill("ABCD012345");
    await panel.getByLabel("关联验证密码").fill("correct horse battery staple");
    await expect(panel.getByRole("button", { name: "确认关联", exact: true })).toBeDisabled();
    expect(approvals).toBe(0);
    await panel.getByRole("checkbox").check();
    await panel.scrollIntoViewIfNeeded();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: info.outputPath(`wechat-binding-${width}.png`) });
    await panel.getByRole("button", { name: "确认关联", exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("网页确认成功，请返回小程序完成开通。");
    expect(approvals).toBe(1);
    expect(authority.snapshot().requestFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/v1/auth/reauthenticate/password" }),
      ]),
    );
  });
