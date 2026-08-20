import {
  accountResourceSchema,
  identityHttpRoutes,
  type AccountResource,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

type Awaitable<Value> = Promise<Value> | Value;

export interface AccountProfileModule {
  read(ownerUserId: string): Awaitable<AccountResource>;
}

export function createAccountProfileApp(options: {
  authenticate(context: Context): Awaitable<string>;
  module: AccountProfileModule;
}) {
  const app = new Hono();
  app.get(identityHttpRoutes.account, async (context) => {
    const owner = await options.authenticate(context);
    const account = accountResourceSchema.parse(await options.module.read(owner));
    context.header("Cache-Control", "private, no-store");
    return context.json(account);
  });
  return app;
}
