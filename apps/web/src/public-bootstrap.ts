import { parseWebEnvironment, type WebEnvironment } from "./environment.js";

export type PublicPage = "home" | "guide" | "privacy";

export interface WebBootstrap {
  environment?: WebEnvironment;
  publicPage?: PublicPage;
  publicDeploymentEnvironment?: WebEnvironment["VITE_DEPLOYMENT_ENVIRONMENT"];
}

export function resolveWebBootstrap(
  pathname: string,
  environment: Record<string, string | undefined>,
): WebBootstrap {
  const publicPage =
    pathname === "/"
      ? "home"
      : pathname === "/guide"
        ? "guide"
        : pathname === "/privacy"
          ? "privacy"
          : undefined;
  if (publicPage !== undefined) {
    const channel = environment.VITE_DEPLOYMENT_ENVIRONMENT;
    return {
      publicPage,
      ...(channel === "production" || channel === "hosted-acceptance"
        ? { publicDeploymentEnvironment: channel }
        : {}),
    };
  }
  try {
    return { environment: parseWebEnvironment(environment) };
  } catch {
    return {};
  }
}
