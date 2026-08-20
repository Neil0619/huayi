import { identityHttpRoutes, quotaSummarySchema, type QuotaSummary } from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

type Awaitable<T> = Promise<T> | T;

export interface AccountQuotaAppOptions {
  authenticate(context: Context): Awaitable<string>;
  quota: {
    summary(userId: string): Awaitable<QuotaSummary>;
  };
}

export function createAccountQuotaApp(options: AccountQuotaAppOptions) {
  const app = new Hono();

  app.get(identityHttpRoutes.quota, async (context) => {
    const userId = await options.authenticate(context);
    const quota = quotaSummarySchema.parse(await options.quota.summary(userId));
    context.header("Cache-Control", "private, no-store");
    return context.json(quota);
  });

  return app;
}
