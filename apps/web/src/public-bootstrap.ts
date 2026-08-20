import { parseWebEnvironment, type WebEnvironment } from "./environment.js";

export type PublicPage = "privacy";

export interface WebBootstrap {
  environment?: WebEnvironment;
  publicPage?: PublicPage;
}

export function resolveWebBootstrap(
  pathname: string,
  environment: Record<string, string | undefined>,
): WebBootstrap {
  if (pathname === "/privacy") return { publicPage: "privacy" };
  try {
    return { environment: parseWebEnvironment(environment) };
  } catch {
    return {};
  }
}
