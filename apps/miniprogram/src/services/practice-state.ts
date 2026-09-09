import type { PracticeSession } from "@huayi/cloud-contracts";

export function mergePractice(
  current: PracticeSession | null,
  incoming: PracticeSession,
): PracticeSession {
  if (!current || current.id !== incoming.id) return incoming;
  if (incoming.revision < current.revision) return current;
  if (!current.workspace || !incoming.workspace) return incoming;
  const draft =
    current.workspace.draftRevision > incoming.workspace.draftRevision
      ? { draft: current.workspace.draft, draftRevision: current.workspace.draftRevision }
      : {};
  const control =
    (current.workspace.controlRevision ?? 0) > (incoming.workspace.controlRevision ?? 0)
      ? {
          phase: current.workspace.phase,
          mode: current.workspace.mode,
          controlRevision: current.workspace.controlRevision,
        }
      : {};
  return { ...incoming, workspace: { ...incoming.workspace, ...draft, ...control } };
}
