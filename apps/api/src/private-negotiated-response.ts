import type { MiddlewareHandler } from "hono";

/** Apply after streaming helpers so their defaults cannot make private results cacheable. */
export const privateNegotiatedResponse: MiddlewareHandler = async (context, next) => {
  await next();
  context.header("Cache-Control", "private, no-store");
  const vary = context.res.headers.get("vary")?.toLowerCase().split(/,\s*/u) ?? [];
  if (!vary.includes("accept")) context.header("Vary", "Accept", { append: true });
};
