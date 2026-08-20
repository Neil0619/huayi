import type { Context } from "hono";

export function cookieValue(context: Context, name: string): string | undefined {
  const cookie = context.req.header("cookie");
  if (cookie === undefined) return undefined;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export function webSessionCookie(context: Context): string | undefined {
  return cookieValue(context, "huayi_session");
}
