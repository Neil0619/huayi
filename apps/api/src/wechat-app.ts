import {
  miniProgramAccountSchema,
  miniProgramBindingApprovalSchema,
  miniProgramBindingStatusSchema,
  miniProgramLoginRequestSchema,
  miniProgramLoginResponseSchema,
  miniProgramOnboardingRequestSchema,
  miniProgramRoutes,
  miniProgramSessionSchema,
  miniProgramTicketRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";
import { CloudFault } from "./cloud-fault.js";
import { miniProgramToken } from "./miniprogram-authentication.js";
import type { MiniProgramIdentity } from "./miniprogram-identity.js";
import { enforceRateLimit, type RateLimiter } from "./rate-limiter.js";
import { hashSecret } from "./security.js";
import { strictJson } from "./strict-json.js";
import { webSessionCookie } from "./web-session-cookie.js";
import type { WechatProvider } from "./wechat-provider.js";

export function createWechatApp(options: {
  identity: MiniProgramIdentity;
  provider: WechatProvider;
  pepper: string;
  authenticateWeb(context: Context): Promise<string>;
  rateLimiter: RateLimiter;
}) {
  const app = new Hono();
  const limit = (context: Context, action: string, subject?: string) =>
    enforceRateLimit(options.rateLimiter, {
      action: `wechat-${action}`,
      limit: 60,
      windowMs: 60_000,
      subject: subject ?? context.req.header("x-vercel-forwarded-for") ?? "unavailable",
    });
  app.use("/v1/auth/wechat/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    await limit(context, "requests");
    await next();
  });
  app.post(miniProgramRoutes.login, async (context) => {
    const input = await strictJson(context, miniProgramLoginRequestSchema);
    const proof = await options.provider.exchange(input.code);
    await limit(context, "identity", `${proof.appId}:${proof.openId}`);
    return context.json(miniProgramLoginResponseSchema.parse(await options.identity.begin(proof)));
  });
  app.post(miniProgramRoutes.onboard, async (context) => {
    const { ticket, mode } = await strictJson(context, miniProgramOnboardingRequestSchema);
    return context.json(
      miniProgramSessionSchema.parse(await options.identity.onboard(ticket, mode)),
    );
  });
  app.post(miniProgramRoutes.bindingStatus, async (context) => {
    const { ticket } = await strictJson(context, miniProgramTicketRequestSchema);
    return context.json(
      miniProgramBindingStatusSchema.parse(await options.identity.bindingStatus(ticket)),
    );
  });
  app.post(miniProgramRoutes.approveBinding, async (context) => {
    if (context.req.header("authorization") !== undefined)
      throw new CloudFault("forbidden", "Web confirmation is required.");
    const owner = await options.authenticateWeb(context);
    const session = webSessionCookie(context);
    if (!session) throw new CloudFault("authentication_required", "Web confirmation is required.");
    const { bindingCode } = await strictJson(context, miniProgramBindingApprovalSchema);
    await limit(context, "binding", owner);
    await options.identity.approveBinding(bindingCode, hashSecret(session, options.pepper), owner);
    return context.body(null, 204);
  });
  app.post(miniProgramRoutes.reauthenticate, async (context) => {
    const token = miniProgramToken(context.req.header("authorization"));
    await options.identity.authenticate(token);
    const input = await strictJson(context, miniProgramLoginRequestSchema);
    await options.identity.reauthenticate(token, await options.provider.exchange(input.code));
    return context.body(null, 204);
  });
  app.post(miniProgramRoutes.logout, async (context) => {
    await options.identity.revoke(miniProgramToken(context.req.header("authorization")));
    return context.body(null, 204);
  });
  app.get(miniProgramRoutes.account, async (context) => {
    const auth = await options.identity.authenticate(
      miniProgramToken(context.req.header("authorization")),
    );
    context.header("Cache-Control", "private, no-store");
    return context.json(
      miniProgramAccountSchema.parse(await options.identity.account(auth.userId)),
    );
  });
  return app;
}
