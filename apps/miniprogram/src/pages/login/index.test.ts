// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { miniProgramRoutes } from "@huayi/cloud-contracts";
import { button, deferred, mount } from "../../components/draft-test-support";
import { session } from "../../services/session";
import { MiniError } from "../../services/errors";
import login from "./index";

const fake = vi.hoisted(() => ({
  request: vi.fn(),
  code: vi.fn(),
  privacy: vi.fn(),
  done: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  useDidShow: vi.fn(),
  useDidHide: vi.fn(),
  default: {
    login: fake.code,
    requirePrivacyAuthorize: fake.privacy,
    switchTab: fake.done,
    getCurrentPages: () => [{ route: "pages/login/index" }],
    getStorageSync: () => "silver",
    setStorageSync: vi.fn(),
    setClipboardData: vi.fn(),
    eventCenter: { on: vi.fn(), off: vi.fn() },
  },
}));
vi.mock(
  "@tarojs/components",
  async () => (await import("../../components/draft-test-support")).testComponents,
);
vi.mock(import("../../services/http"), async (importOriginal) => ({
  ...(await importOriginal()),
  rawRequest: fake.request,
}));

const onboarding = {
  state: "onboarding",
  ticket: "t".repeat(43),
  bindingCode: "012345ABCD",
  expiresAt: "2099-09-10T00:00:00Z",
};
const authenticated = {
  state: "authenticated",
  token: "a".repeat(43),
  expiresAt: "2099-09-10T00:00:00Z",
};
const account = { id: "00000000-0000-4000-8000-000000000001", email: null, linkedToWeb: false };
let view: ReturnType<typeof mount>;
async function click(label: string) {
  await act(async () => button(view.container, label).click());
}
async function enterLink() {
  await click("同意隐私说明并微信登录");
  await click("关联已有语见账号");
}
beforeEach(() => {
  session.clear();
  vi.resetAllMocks();
  vi.stubGlobal("MINIPROGRAM_API_ORIGIN", "https://api.example.test");
  fake.code.mockResolvedValue({ code: "wx-code" });
  fake.request.mockImplementation(async (path: string) => {
    if (path === miniProgramRoutes.login) return onboarding;
    if (path === miniProgramRoutes.onboard) return authenticated;
    if (path === miniProgramRoutes.account) return account;
    return { status: "pending" };
  });
  view = mount(createElement(login));
});
afterEach(() => {
  view.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows missing configuration before requesting privacy consent or WeChat login", async () => {
  vi.stubGlobal("MINIPROGRAM_API_ORIGIN", "");
  const loginAttempt = vi.spyOn(session, "login");
  await click("同意隐私说明并微信登录");
  expect(view.container.textContent).toContain("体验环境尚未配置，请联系维护者完成小程序接入。");
  expect(button(view.container, "同意隐私说明并微信登录").disabled).toBe(false);
  expect(fake.privacy).not.toHaveBeenCalled();
  expect(loginAttempt).not.toHaveBeenCalled();
  expect(fake.code).not.toHaveBeenCalled();
  expect(fake.request).not.toHaveBeenCalled();
  expect(fake.done).not.toHaveBeenCalled();
});

it("requests privacy consent and allows independent onboarding after choosing and returning from linking", async () => {
  await enterLink();
  expect(fake.privacy).toHaveBeenCalledOnce();
  expect(view.container.textContent).toContain("账号与额度 → 微信小程序关联");
  expect(view.container.textContent).toContain(onboarding.bindingCode);
  await click("返回选择开通方式");
  expect(view.container.textContent).toContain("选择开通方式");
  await click("直接开始使用");
  expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.onboard, {
    method: "POST",
    data: { ticket: onboarding.ticket, mode: "independent" },
  });
  expect(session.getSnapshot().account).toEqual(account);
  expect(fake.done).toHaveBeenCalledWith({ url: "/pages/today/index" });
});

it.each(["pending", "expired"] as const)(
  "clears a %s notice after successfully obtaining a new binding code",
  async (status) => {
    await enterLink();
    fake.request.mockResolvedValueOnce({ status });
    await click("我已在网页确认");
    const notice = status === "expired" ? "绑定码已过期" : "尚未收到网页确认";
    expect(view.container.textContent).toContain(notice);
    const exchange = deferred<unknown>();
    fake.request.mockReturnValueOnce(exchange.promise);
    await click("重新获取绑定码");
    expect(button(view.container, "重新获取绑定码").disabled).toBe(true);
    await act(async () =>
      exchange.resolve({ ...onboarding, ticket: "n".repeat(43), bindingCode: "ABCDEF1234" }),
    );
    expect(view.container.textContent).toContain("ABCDEF1234");
    expect(view.container.textContent).not.toContain(onboarding.bindingCode);
    expect(view.container.textContent).not.toContain(notice);
    await click("返回选择开通方式");
    await click("直接开始使用");
    expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.onboard, {
      method: "POST",
      data: { ticket: "n".repeat(43), mode: "independent" },
    });
  },
);

it("keeps the old ticket recoverable after a failed code exchange and can return to independent use", async () => {
  await enterLink();
  fake.request.mockRejectedValueOnce(new MiniError("network_error"));
  await click("重新获取绑定码");
  expect(view.container.textContent).toContain("连接中断");
  expect(view.container.textContent).toContain(onboarding.bindingCode);
  expect(button(view.container, "重新获取绑定码").disabled).toBe(false);
  await click("返回选择开通方式");
  expect(view.container.textContent).not.toContain("连接中断");
  await click("直接开始使用");
  expect(fake.done).toHaveBeenCalledOnce();
});

it("shows a failed binding lookup with retry and return controls, then completes an approved binding", async () => {
  await enterLink();
  fake.request.mockRejectedValueOnce(new MiniError("network_error"));
  await click("我已在网页确认");
  expect(view.container.textContent).toContain("连接中断");
  expect(button(view.container, "返回选择开通方式").disabled).toBe(false);
  fake.request.mockResolvedValueOnce({ status: "approved" });
  await click("我已在网页确认");
  expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.onboard, {
    method: "POST",
    data: { ticket: onboarding.ticket, mode: "linked" },
  });
  expect(fake.done).toHaveBeenCalledOnce();
});

it("recovers an expired independent ticket by redoing WeChat login from the opening chooser", async () => {
  await click("同意隐私说明并微信登录");
  fake.request.mockRejectedValueOnce(new MiniError("authentication_required"));
  await click("直接开始使用");
  expect(view.container.textContent).toContain("请重新微信登录");
  fake.request.mockResolvedValueOnce({ ...onboarding, ticket: "n".repeat(43) });
  await click("重新微信登录");
  await click("直接开始使用");
  expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.onboard, {
    method: "POST",
    data: { ticket: "n".repeat(43), mode: "independent" },
  });
  expect(fake.done).toHaveBeenCalledOnce();
});

it("keeps a failed initial WeChat login retryable and opens an existing authenticated account", async () => {
  fake.code.mockRejectedValueOnce(new MiniError("network_error"));
  await click("同意隐私说明并微信登录");
  expect(view.container.textContent).toContain("连接中断");
  fake.request.mockResolvedValueOnce(authenticated);
  await click("同意隐私说明并微信登录");
  expect(session.getSnapshot().account).toEqual(account);
  expect(fake.done).toHaveBeenCalledOnce();
});
