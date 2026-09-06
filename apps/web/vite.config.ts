import { defineConfig, type UserConfig } from "vite";

const fullCommitPattern = /^[0-9a-f]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;

interface HostedDeploymentIdentity {
  commit: string;
  deploymentId: string;
  releaseChannel?: "hosted-acceptance" | "production";
}

export function injectHostedDeploymentAttestation(
  html: string,
  identity: HostedDeploymentIdentity | undefined,
): string {
  if (identity === undefined) return html;
  const releaseChannel = identity.releaseChannel ?? "hosted-acceptance";
  if (
    !fullCommitPattern.test(identity.commit) ||
    !deploymentIdPattern.test(identity.deploymentId) ||
    !["hosted-acceptance", "production"].includes(releaseChannel) ||
    html.includes('name="huayi-deployment-') ||
    !html.includes("</head>")
  ) {
    throw new Error("Web deployment identity is invalid.");
  }
  const attestation = [
    `<meta name="huayi-deployment-commit" content="${identity.commit}">`,
    `<meta name="huayi-deployment-id" content="${identity.deploymentId}">`,
    `<meta name="huayi-release-channel" content="${releaseChannel}">`,
  ].join("\n    ");
  return html.replace("</head>", `  ${attestation}\n  </head>`);
}

export function createViteConfiguration(
  environment: Record<string, string | undefined>,
): UserConfig {
  const releaseChannel = environment.VITE_DEPLOYMENT_ENVIRONMENT;
  if (
    (releaseChannel !== undefined &&
      releaseChannel !== "hosted-acceptance" &&
      releaseChannel !== "production") ||
    (releaseChannel === undefined && environment.VITE_API_ORIGIN === "https://api.seen-said.cn")
  ) {
    throw new Error("Web deployment environment is invalid.");
  }
  const deployed = releaseChannel !== undefined;
  const commit = deployed ? environment.VERCEL_GIT_COMMIT_SHA : undefined;
  const deploymentId = deployed ? environment.VERCEL_DEPLOYMENT_ID : undefined;
  const expectedApiOrigin =
    releaseChannel === "production"
      ? "https://api.seen-said.cn"
      : "https://api.acceptance.seen-said.cn";
  if (
    deployed &&
    (commit === undefined ||
      !fullCommitPattern.test(commit) ||
      deploymentId === undefined ||
      !deploymentIdPattern.test(deploymentId) ||
      environment.VITE_API_ORIGIN !== expectedApiOrigin)
  ) {
    throw new Error("Web deployment origin or identity is invalid.");
  }
  return {
    build: {
      target: "es2022",
    },
    define: {
      HUAYI_DEPLOYMENT_COMMIT: JSON.stringify(commit ?? ""),
    },
    plugins:
      commit === undefined || deploymentId === undefined || releaseChannel === undefined
        ? []
        : [
            {
              name: "huayi-hosted-deployment-attestation",
              transformIndexHtml: (html) =>
                injectHostedDeploymentAttestation(html, { commit, deploymentId, releaseChannel }),
            },
          ],
  };
}

export default defineConfig(createViteConfiguration(process.env));
