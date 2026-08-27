import { Hono, type Hono as HonoApp } from "hono";

export interface HostedDeploymentIdentity {
  commit: string;
  deploymentId: string;
}

interface HostedDeploymentEnvironment {
  readonly VERCEL_DEPLOYMENT_ID?: string | undefined;
  readonly VERCEL_GIT_COMMIT_SHA?: string | undefined;
}

const commitPattern = /^[0-9a-f]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;

export function hostedDeploymentHeaders(
  identity?: HostedDeploymentIdentity,
): Readonly<Record<string, string>> {
  if (identity === undefined) return Object.freeze({});
  if (
    Object.keys(identity).sort().join("|") !== "commit|deploymentId" ||
    !commitPattern.test(identity.commit) ||
    !deploymentIdPattern.test(identity.deploymentId)
  ) {
    throw new TypeError("Invalid hosted deployment identity.");
  }
  return Object.freeze({
    "x-huayi-deployment-commit": identity.commit,
    "x-huayi-deployment-id": identity.deploymentId,
    "x-huayi-release-channel": "hosted-acceptance",
  });
}

export function hostedDeploymentIdentityFromEnvironment(
  environment: HostedDeploymentEnvironment,
): HostedDeploymentIdentity | undefined {
  if (
    environment.VERCEL_DEPLOYMENT_ID === undefined ||
    environment.VERCEL_GIT_COMMIT_SHA === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    commit: environment.VERCEL_GIT_COMMIT_SHA,
    deploymentId: environment.VERCEL_DEPLOYMENT_ID,
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
