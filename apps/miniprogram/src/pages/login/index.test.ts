// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { miniProgramRoutes } from "@huayi/cloud-contracts";
import { button, deferred, input, mount } from "../../components/draft-test-support";
import { session } from "../../services/session";
import { MiniError } from "../../services/errors";
import login from "./index";

const fake = vi.hoisted(() => ({
  request: vi.fn(),
  code: vi.fn(),
  privacy: vi.fn(),
  done: vi.fn(),
  hide: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({
  useDidShow: vi.fn(),
  useDidHide: fake.hide,
  default: {
    login: fake.code,
    requirePrivacyAuthorize: fake.privacy,
    switchTab: fake.done,
    getCurrentPages: () => [{ route: "pages/login/index" }],
    getStorageSync: () => "silver",
    setStorageSync: fake.storage,
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
    if (path === miniProgramRoutes.onboard || path === miniProgramRoutes.loginAndLink)
      return authenticated;
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
  expect(view.container.textContent).toContain("登录并关联");
  expect(view.container.textContent).not.toContain(onboarding.bindingCode);
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

function fillCredentials() {
  input(view.container, " Friend@Example.com ", "input:first-of-type");
  input(view.container, "correct horse battery staple", "input:nth-of-type(2)");
}

it("logs in and links once with visible consent, clearing the password immediately", async () => {
  await enterLink();
  expect(button(view.container, "登录并关联").disabled).toBe(true);
  expect(view.container.querySelectorAll("input")[1]?.type).toBe("password");
  fillCredentials();
  const response = deferred<unknown>();
  fake.request.mockReturnValueOnce(response.promise);
  await click("登录并关联");
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  expect(button(view.container, "正在登录并关联…").disabled).toBe(true);
  expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.loginAndLink, {
    method: "POST",
    data: {
      ticket: onboarding.ticket,
      email: "friend@example.com",
      password: "correct horse battery staple",
      confirmed: true,
    },
  });
  await act(async () => response.resolve(authenticated));
  expect(fake.done).toHaveBeenCalledOnce();
  expect(fake.storage.mock.calls).toEqual([["seen-said:remember-login", true]]);
  expect(fake.request.mock.calls.some(([path]) => path === miniProgramRoutes.bindingStatus)).toBe(
    false,
  );
});

it("keeps the email and shows an actionable login error without another verification prompt", async () => {
  await enterLink();
  fillCredentials();
  fake.request.mockRejectedValueOnce(new MiniError("authentication_required"));
  await click("登录并关联");
  expect(view.container.textContent).toContain("账号密码或关联凭证不可用");
  expect(view.container.querySelectorAll("input")[0]?.value).toContain("Friend@Example.com");
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  expect(fake.done).not.toHaveBeenCalled();
  input(view.container, "correct horse battery staple", "input:nth-of-type(2)");
  await click("登录并关联");
  expect(fake.done).toHaveBeenCalledOnce();
});

it("recovers an uncertain linking result through WeChat login without automatically replaying credentials", async () => {
  await enterLink();
  fillCredentials();
  fake.request.mockRejectedValueOnce(new MiniError("network_error"));
  await click("登录并关联");
  expect(view.container.textContent).toContain("关联结果尚未确认");
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  expect(
    fake.request.mock.calls.filter(([path]) => path === miniProgramRoutes.loginAndLink),
  ).toHaveLength(1);
  fake.request.mockResolvedValueOnce(authenticated);
  await click("重新微信登录");
  expect(fake.done).toHaveBeenCalledOnce();
});

it("refreshes an expired ticket and can return to independent use without retaining the password", async () => {
  await enterLink();
  fillCredentials();
  const response = deferred<unknown>();
  fake.request.mockReturnValueOnce(response.promise);
  await click("重新微信登录");
  expect(button(view.container, "重新微信登录").disabled).toBe(true);
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  await act(async () => response.resolve({ ...onboarding, ticket: "n".repeat(43) }));
  await click("返回选择开通方式");
  await click("直接开始使用");
  expect(fake.request).toHaveBeenCalledWith(miniProgramRoutes.onboard, {
    method: "POST",
    data: { ticket: "n".repeat(43), mode: "independent" },
  });
  expect(fake.done).toHaveBeenCalledOnce();
});

it("clears password on hide and on returning from linking", async () => {
  await enterLink();
  fillCredentials();
  await act(async () => {
    for (const [hide] of fake.hide.mock.calls) hide();
  });
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  fillCredentials();
  await click("返回选择开通方式");
  await click("关联已有语见账号");
  expect(view.container.querySelectorAll("input")[1]?.value).toBe("");
  expect(fake.storage).not.toHaveBeenCalled();
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
