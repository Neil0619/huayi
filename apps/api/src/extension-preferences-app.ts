import {
  extensionPreferencesResponseSchema,
  identityHttpRoutes,
  type ExtensionPreferences,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

type Awaitable<T> = Promise<T> | T;

export function createExtensionPreferencesApp(options: {
  authenticate(context: Context): Awaitable<string>;
  read(ownerUserId: string): Awaitable<ExtensionPreferences>;
}) {
  const app = new Hono();
  app.get(identityHttpRoutes.extensionPreferences, async (context) => {
    if (new URL(context.req.url).search !== "") return context.body(null, 400);
    const owner = await options.authenticate(context);
    context.header("Cache-Control", "private, no-store");
    return context.json(extensionPreferencesResponseSchema.parse(await options.read(owner)));
  });
  return app;
}
