import {
  accountPreferencesRequestSchema,
  accountPreferencesResponseSchema,
  identityHttpRoutes,
  type AccountPreferences,
  type AccountPreferencesRequest,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

type Awaitable<T> = Promise<T> | T;

export interface AccountPreferencesRepository {
  read(ownerUserId: string): Awaitable<AccountPreferences>;
  update(
    ownerUserId: string,
    preferences: AccountPreferencesRequest,
  ): Awaitable<AccountPreferences>;
}

export function createAccountPreferencesApp(options: {
  authenticate(context: Context): Awaitable<string>;
  repository: AccountPreferencesRepository;
}) {
  const app = new Hono();
  app.get(identityHttpRoutes.accountPreferences, async (context) => {
    const owner = await options.authenticate(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(
      accountPreferencesResponseSchema.parse(await options.repository.read(owner)),
    );
  });
  app.patch(identityHttpRoutes.accountPreferences, async (context) => {
    const owner = await options.authenticate(context);
    const input = accountPreferencesRequestSchema.parse(await context.req.json());
    context.header("Cache-Control", "private, no-store");
    return context.json(
      accountPreferencesResponseSchema.parse(await options.repository.update(owner, input)),
    );
  });
  return app;
}
