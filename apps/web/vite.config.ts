import { defineConfig, type UserConfig } from "vite";

const fullCommitPattern = /^[0-9a-f]{40}$/u;

export function createViteConfiguration(
  environment: Record<string, string | undefined>,
): UserConfig {
  const hosted = environment.VITE_DEPLOYMENT_ENVIRONMENT === "hosted-acceptance";
  const commit = hosted ? environment.VERCEL_GIT_COMMIT_SHA : undefined;
  if (environment.VITE_DEPLOYMENT_ENVIRONMENT !== undefined && !hosted) {
    throw new Error("Web deployment environment is invalid.");
  }
  if (hosted && (commit === undefined || !fullCommitPattern.test(commit))) {
    throw new Error("Hosted acceptance build commit is unavailable.");
  }
  return {
    build: {
      target: "es2022",
    },
    define: {
      HUAYI_DEPLOYMENT_COMMIT: JSON.stringify(commit ?? ""),
    },
  };
}

export default defineConfig(createViteConfiguration(process.env));
