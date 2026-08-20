import type { AuthRoute } from "./auth-page.js";

const invitationFragment = /^#[A-Za-z0-9_-]{32,2048}$/u;

export function parseAuthRoute(pathname: string, hash: string): AuthRoute | undefined {
  if (pathname === "/login" && hash === "") return { mode: "login" };
  if (pathname !== "/join" || !invitationFragment.test(hash)) return undefined;
  return { invitationToken: hash.slice(1), mode: "join" };
}
