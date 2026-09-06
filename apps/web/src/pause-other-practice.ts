import type { WebPracticeWorkspace } from "./practice-workspace-api.js";

/** Pause preserves the independently saved draft and does not cancel generation. */
export async function pauseOtherPractice(
  workspace: WebPracticeWorkspace | undefined,
  key: () => string,
  except?: string,
) {
  if (!workspace) return;
  const sessions = await workspace.list();
  for (const session of sessions) {
    if (
      session.id === except ||
      (session.workspace?.phase ?? "active") !== "active" ||
      session.items.every((item) => item.rating !== undefined)
    )
      continue;
    const latest = await workspace.get(session.id);
    await workspace.control(
      latest.id,
      {
        action: "pause",
        expectedRevision: latest.revision,
        expectedControlRevision: latest.workspace?.controlRevision ?? 0,
      },
      key(),
    );
  }
}
