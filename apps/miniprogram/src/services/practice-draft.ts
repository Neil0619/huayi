import type { PracticeSession } from "@huayi/cloud-contracts";
export interface SubmittedDraft {
  sessionId: string;
  revision: number;
  text: string;
  attemptCount: number;
  turnCount: number;
}
export function draftWasSaved(pending: SubmittedDraft, session: PracticeSession) {
  if (pending.sessionId !== session.id || session.revision <= pending.revision) return false;
  return session.type === "sentence-creation"
    ? !!session.attempts
        ?.slice(pending.attemptCount)
        .some((attempt) => attempt.answer === pending.text.trim())
    : session.turns
        .slice(pending.turnCount)
        .some((turn) => turn.role === "user" && turn.content === pending.text.trim());
}
