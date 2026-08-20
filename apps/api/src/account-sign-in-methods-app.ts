import {
  accountSignInMethodsResponseSchema,
  identityHttpRoutes,
  type SignInMethod,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

type Awaitable<Value> = Promise<Value> | Value;

export interface SignInMethodRecord {
  linkedAt: Date;
  method: SignInMethod;
}

export function createAccountSignInMethodsApp(options: {
  authenticate(context: Context): Awaitable<string>;
  read(ownerUserId: string): Awaitable<readonly SignInMethodRecord[]>;
}) {
  const app = new Hono();
  app.get(identityHttpRoutes.accountSignInMethods, async (context) => {
    const owner = await options.authenticate(context);
    const records = await options.read(owner);
    const response = accountSignInMethodsResponseSchema.parse({
      methods: records.map((record) => ({
        ...record,
        linkedAt: record.linkedAt.toISOString(),
      })),
    });
    context.header("Cache-Control", "private, no-store");
    return context.json(response);
  });
  return app;
}
