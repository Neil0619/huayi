export const expectedVercelOneShotBaselines = Object.freeze({
  api: Object.freeze({
    count: 16,
    latestCommit: "4f1ce4a458fe138aeee6fb455b2dcc398a55555a",
    latestDeploymentId: "6QeRbqxgA88cFXggKekkr2axH9JM",
  }),
  web: Object.freeze({
    count: 9,
    latestCommit: "9b0860a91940e4f78968b3882af91ef5bf923b8a",
    latestDeploymentId: "V3NzjTYXtH7fb3WC2P6hpWR1twhb",
  }),
});

export function renderVercelOneShotPlan() {
  return [
    "Hosted Vercel API/Web serial one-shot gate (read-only remote verification)",
    "Configured baseline:",
    "- API non-Canceled baseline: 16",
    "- Web non-Canceled baseline: 9",
    "Required sequence:",
    "- preflight: clean exact upstream commit; both projects disarmed; exact baseline; zero in-flight",
    "- API arm -> exactly one non-Canceled deployment -> independent API disarm -> Ready and zero extra non-Canceled deployment",
    "- Web cannot arm before API disarm is verified",
    "- Web arm -> exactly one non-Canceled deployment -> independent Web disarm -> Ready and zero extra non-Canceled deployment",
    "Safety:",
    "- A disarmed project may add at most one same-push Canceled audit; each accepted audit is frozen for later stages.",
    "- Both projects armed, wrong branch/project/commit, history drift, ambiguity, extra or in-flight deployment fails closed.",
    "- The gate performs read-only Vercel requests; it never arms, disarms, deploys, commits, or pushes.",
    "- VERCEL_TOKEN is never printed or persisted.",
    "",
  ].join("\n");
}
