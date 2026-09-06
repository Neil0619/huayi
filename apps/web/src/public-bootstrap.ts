import { parseWebEnvironment, type WebEnvironment } from "./environment.js";

export type PublicPage = "privacy";

export interface WebBootstrap {
  environment?: WebEnvironment;
  publicPage?: PublicPage;
  publicDeploymentEnvironment?: WebEnvironment["VITE_DEPLOYMENT_ENVIRONMENT"];
}

export function resolveWebBootstrap(
  pathname: string,
  environment: Record<string, string | undefined>,
): WebBootstrap {
  if (pathname === "/privacy") {
    const channel = environment.VITE_DEPLOYMENT_ENVIRONMENT;
    return {
      publicPage: "privacy",
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
