export const expectedTeamName = "neil0619's projects";
export const expectedTeamSlug = "neil0619s-projects";

export const vercelProjectsApplyConfirmation = "--confirm-vercel-empty-projects-neil0619s-projects";
export const vercelProjectsStatusArgument = "--status-vercel-empty-projects-neil0619s-projects";

export const vercelProjectSpecifications = Object.freeze([
  Object.freeze({
    name: "seen-said-acceptance-api",
    settings: Object.freeze({
      buildCommand: null,
      framework: "hono",
      nodeVersion: "22.x",
      outputDirectory: null,
      previewDeploymentsDisabled: true,
      resourceConfig: Object.freeze({
        fluid: true,
        functionDefaultRegions: Object.freeze(["sin1"]),
        functionDefaultTimeout: 120,
      }),
      rootDirectory: "apps/api",
      sourceFilesOutsideRootDirectory: true,
    }),
  }),
  Object.freeze({
    name: "seen-said-acceptance-web",
    settings: Object.freeze({
      buildCommand: "pnpm build",
      framework: "vite",
      nodeVersion: "22.x",
      outputDirectory: "dist",
      previewDeploymentsDisabled: true,
      rootDirectory: "apps/web",
      sourceFilesOutsideRootDirectory: true,
    }),
  }),
]);

export function renderVercelProjectPlan() {
  return [
    "Vercel hosted acceptance empty-project plan (offline / zero write)",
    `Scope: ${expectedTeamName} | ${expectedTeamSlug}`,
    "Projects:",
    "- seen-said-acceptance-api | apps/api | hono | 22.x | sin1 | Fluid | 120s",
    "- seen-said-acceptance-web | apps/web | vite | 22.x | pnpm build | dist",
    "REST contract:",
    "- GET /v2/teams resolves the exact token-scoped team.",
    "- POST /v11/projects creates name-only project shells without gitRepository.",
    "- PATCH /v9/projects/{idOrName} freezes supported project settings.",
    "- GET /v7/deployments proves each project remains empty before and after PATCH.",
    "- Preview Deployments disabled is requested through the official project field.",
    "Dashboard gates before Git connection:",
    "- Production Branch: codex/settings-configuration",
    "- Preview Deployments disabled: Dashboard readback required",
    "- Production-only environment variables remain pending for the later secret stage.",
    "No Git link, deployment, domain, environment variable, or secret is created.",
    "VERCEL_TOKEN is read only by apply/status and is never printed or persisted.",
    "",
  ].join("\n");
}
