import { describe, expect, it, vi } from "vitest";

import { createWechatProvider } from "./wechat-provider.js";

describe("WeChat identity proof", () => {
  it("exchanges only against the fixed WeChat endpoint and returns no session key", async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      Response.json({ openid: "wechat-subject", session_key: "private-key" }),
    );
    const provider = createWechatProvider({
      appId: "wx0123456789abcdef",
      appSecret: "secret",
      fetch: fetcher,
    });
    await expect(provider.exchange("one-use-code")).resolves.toEqual({
      appId: "wx0123456789abcdef",
      openId: "wechat-subject",
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.weixin.qq.com/sns/jscode2session");
    expect(url.searchParams.get("js_code")).toBe("one-use-code");
  });

  it.each([
    { errcode: 40029, errmsg: "secret upstream message" },
    { openid: "", session_key: "private" },
  ])("fails closed for an invalid proof without leaking provider data", async (response) => {
    const provider = createWechatProvider({
      appId: "wx0123456789abcdef",
      appSecret: "secret",
      fetch: async () => Response.json(response),
    });
    await expect(provider.exchange("code")).rejects.toMatchObject({
      code: "authentication_required",
      message: "WeChat authentication failed.",
    });
  });

  it("does not retry a potentially consumed code", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("https://secret.example/?secret=credential");
    });
    const provider = createWechatProvider({
      appId: "wx0123456789abcdef",
      appSecret: "secret",
      fetch: fetcher,
    });
    await expect(provider.exchange("code")).rejects.toThrow("WeChat authentication failed.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
