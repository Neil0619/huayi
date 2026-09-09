import { z } from "zod";

import { CloudFault } from "./cloud-fault.js";

export interface WechatProof {
  appId: string;
  openId: string;
}
export interface WechatProvider {
  exchange(code: string): Promise<WechatProof>;
}
export function createWechatProvider(options: {
  appId: string;
  appSecret: string;
  fetch?: typeof fetch;
}): WechatProvider {
  return {
    async exchange(code) {
      try {
        const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
        url.search = new URLSearchParams({
          appid: options.appId,
          secret: options.appSecret,
          js_code: code,
          grant_type: "authorization_code",
        }).toString();
        const response = await (options.fetch ?? fetch)(url, {
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Invalid response.");
        const body = z
          .object({ openid: z.string().min(1).max(256), errcode: z.literal(0).optional() })
          .parse(await response.json());
        return { appId: options.appId, openId: body.openid };
      } catch {
        // Provider errors can include the request URL with AppSecret. Never retain their cause.
        throw new CloudFault("authentication_required", "WeChat authentication failed.");
      }
    },
  };
}
