import { Hono, type Hono as HonoApp } from "hono";

export interface HostedDeploymentIdentity {
  commit: string;
  deploymentId: string;
  releaseChannel?: "hosted-acceptance" | "production";
}

interface HostedDeploymentEnvironment {
  readonly HUAYI_DEPLOYMENT_ENVIRONMENT?: "hosted-acceptance" | "production" | undefined;
  readonly VERCEL_DEPLOYMENT_ID?: string | undefined;
  readonly VERCEL_GIT_COMMIT_SHA?: string | undefined;
}

const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;

export function hostedDeploymentHeaders(
  identity?: HostedDeploymentIdentity,
): Readonly<Record<string, string>> {
  if (identity === undefined) return Object.freeze({});
  const releaseChannel = identity.releaseChannel ?? "hosted-acceptance";
  if (
    !["commit|deploymentId", "commit|deploymentId|releaseChannel"].includes(
      Object.keys(identity).sort().join("|"),
    ) ||
    !["hosted-acceptance", "production"].includes(releaseChannel) ||
    !commitPattern.test(identity.commit) ||
    !deploymentIdPattern.test(identity.deploymentId)
  ) {
    throw new TypeError("Invalid hosted deployment identity.");
  }
  return Object.freeze({
    "x-huayi-deployment-commit": identity.commit,
    "x-huayi-deployment-id": identity.deploymentId,
    "x-huayi-release-channel": releaseChannel,
  });
}

export function hostedDeploymentIdentityFromEnvironment(
  environment: HostedDeploymentEnvironment,
): HostedDeploymentIdentity | undefined {
  if (
    environment.VERCEL_DEPLOYMENT_ID === undefined ||
    environment.VERCEL_GIT_COMMIT_SHA === undefined
  ) {
    if (environment.HUAYI_DEPLOYMENT_ENVIRONMENT !== undefined) {
      throw new TypeError("Explicit deployment environment requires a complete identity.");
    }
    return undefined;
  }
  return Object.freeze({
    commit: environment.VERCEL_GIT_COMMIT_SHA,
    deploymentId: environment.VERCEL_DEPLOYMENT_ID,
    releaseChannel: environment.HUAYI_DEPLOYMENT_ENVIRONMENT ?? "hosted-acceptance",
  });
}

export function createHealthApp(identity?: HostedDeploymentIdentity): HonoApp {
  const app = new Hono();
  const headers = hostedDeploymentHeaders(identity);
  app.get("/health", (context) => {
    for (const [name, value] of Object.entries(headers)) context.header(name, value);
    return context.json({ service: "huayi-cloud-api", status: "ok" });
  });
  return app;
}
