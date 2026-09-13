import type { PracticeSession, PracticeTeachingDetail } from "@huayi/cloud-contracts";

export function practiceGenerationStatus(kind: string, session: PracticeSession | null) {
  if (kind === "sentence-reference") return "参考表达已准备好。";
  if (session?.pendingGeneration) return "题目尚未完成，可以重试或自由造句。";
  if (session?.status === "completed")
    return session.items.every((item) => item.rating !== undefined)
      ? "反馈已完成，本次自评已保留。"
      : "反馈已完成，请自评。";
  return "题目已生成，可以开始作答。";
}

/** Business/control state and the independently saved draft advance monotonically. */
export function mergePracticeSession(current: PracticeSession | null, next: PracticeSession) {
  if (!current || current.id !== next.id) return next;
  const base =
    next.revision >= current.revision &&
    (next.workspace?.controlRevision ?? 0) >= (current.workspace?.controlRevision ?? 0)
      ? next
      : current;
  const draft =
    (next.workspace?.draftRevision ?? 0) > (current.workspace?.draftRevision ?? 0)
      ? next.workspace
      : current.workspace;
  if (!base.workspace || !draft) return base;
  return {
    ...base,
    workspace: { ...base.workspace, draft: draft.draft, draftRevision: draft.draftRevision },
  };
}

export function practiceTeachingMatches(detail: PracticeTeachingDetail, session: PracticeSession) {
  return (
    detail.session.id === session.id &&
    detail.session.revision === session.revision &&
    (detail.session.workspace?.controlRevision ?? 0) === (session.workspace?.controlRevision ?? 0)
  );
}

export function isResumablePractice(session: PracticeSession) {
  return (
    !["ended", "skipped"].includes(session.workspace?.phase ?? "active") &&
    (session.status !== "completed" || session.items.some((item) => item.rating === undefined))
  );
}
