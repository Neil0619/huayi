import { defineConfig, type UserConfig } from "vite";

const fullCommitPattern = /^[0-9a-f]{40}$/u;
const deploymentIdPattern = /^dpl_[A-Za-z0-9_-]{3,128}$/u;

interface HostedDeploymentIdentity {
  commit: string;
  deploymentId: string;
}

export function injectHostedDeploymentAttestation(
  html: string,
  identity: HostedDeploymentIdentity | undefined,
): string {
  if (identity === undefined) return html;
  if (
    !fullCommitPattern.test(identity.commit) ||
    !deploymentIdPattern.test(identity.deploymentId) ||
    html.includes('name="huayi-deployment-') ||
    !html.includes("</head>")
  ) {
    throw new Error("Hosted acceptance deployment identity is invalid.");
  }
  const attestation = [
    `<meta name="huayi-deployment-commit" content="${identity.commit}">`,
    `<meta name="huayi-deployment-id" content="${identity.deploymentId}">`,
    '<meta name="huayi-release-channel" content="hosted-acceptance">',
  ].join("\n    ");
  return html.replace("</head>", `  ${attestation}\n  </head>`);
}

export function createViteConfiguration(
  environment: Record<string, string | undefined>,
): UserConfig {
  const hosted = environment.VITE_DEPLOYMENT_ENVIRONMENT === "hosted-acceptance";
  const commit = hosted ? environment.VERCEL_GIT_COMMIT_SHA : undefined;
  const deploymentId = hosted ? environment.VERCEL_DEPLOYMENT_ID : undefined;
  if (environment.VITE_DEPLOYMENT_ENVIRONMENT !== undefined && !hosted) {
    throw new Error("Web deployment environment is invalid.");
  }
  if (
    hosted &&
    (commit === undefined ||
      !fullCommitPattern.test(commit) ||
      deploymentId === undefined ||
      !deploymentIdPattern.test(deploymentId))
  ) {
    throw new Error("Hosted acceptance build commit is unavailable.");
  }
  return {
    build: {
      target: "es2022",
    },
    define: {
      HUAYI_DEPLOYMENT_COMMIT: JSON.stringify(commit ?? ""),
    },
    plugins:
      commit === undefined || deploymentId === undefined
        ? []
        : [
            {
              name: "huayi-hosted-deployment-attestation",
              transformIndexHtml: (html) =>
                injectHostedDeploymentAttestation(html, { commit, deploymentId }),
            },
          ],
  };
}

export default defineConfig(createViteConfiguration(process.env));
