import { randomUUID } from "node:crypto";
import type { PracticeSession } from "@huayi/cloud-contracts";
import { createCurrentDatabaseFixture } from "./current-database-fixture.js";
import { createPgliteAnalysisDatabase } from "./postgres-analysis-database.js";
import { createPracticeWorkspace } from "../practice-workspace.js";
import { createPracticeTeaching } from "../practice-teaching.js";
import { createPostgresPracticeRepository } from "../postgres-practice-repository.js";

export const practiceOwner = "00000000-0000-0000-0000-000000000001";
export const practiceOther = "00000000-0000-0000-0000-000000000002";
export const practiceItemId = "60000000-0000-0000-0000-000000000001";
export const practiceContent = {
  type: "expression",
  text: "at least",
  meaningZh: "至少",
  usageZh: "说明最小数量。",
};
export function practiceVersions(session: PracticeSession) {
  return {
    expectedRevision: session.revision,
    expectedControlRevision: session.workspace?.controlRevision ?? 0,
    expectedDraftRevision: session.workspace?.draftRevision ?? 0,
  };
}
export async function createPracticeTeachingFixture() {
  const db = await createCurrentDatabaseFixture();
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'a@example.test','active','UTC',5),($2,$2,'b@example.test','active','UTC',5)",
    [practiceOwner, practiceOther],
  );
  await db.query(
    "INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content) VALUES($1,$2,'expression','at least',$3::jsonb)",
    [practiceItemId, practiceOwner, JSON.stringify(practiceContent)],
  );
  await db.query(
    "INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at) VALUES($1,$2,-1,NULL)",
    [practiceItemId, practiceOwner],
  );
  const database = createPgliteAnalysisDatabase(db);
  const workspace = createPracticeWorkspace(database);
  const teaching = createPracticeTeaching(database);
  const repository = createPostgresPracticeRepository(database);
  const begin = async (hints = true) => {
    const created = await workspace.start(
      practiceOwner,
      {
        itemId: practiceItemId,
        mode: hints ? "guided" : "free",
        teachingContract: "practice-teaching-v1",
        ...(hints ? { hintPolicy: "on-demand" } : {}),
      },
      randomUUID(),
    );
    if (hints)
      await db.query(
        "UPDATE practice_sessions SET prompt='向同事说明你至少需要两天。',status='active',pending_generation=NULL,revision=revision+1 WHERE id=$1",
        [created.id],
      );
    return workspace.get(practiceOwner, created.id);
  };
  const submit = (
    session: PracticeSession,
    key: string = randomUUID(),
    attemptId: string = randomUUID(),
  ) =>
    repository.recordAttempt({
      ownerUserId: practiceOwner,
      sessionId: session.id,
      expectedRevision: session.revision,
      answer: "I need at least two days.",
      attemptId,
      idempotencyKey: key,
      requestHash: "a".repeat(64),
      now: new Date().toISOString(),
      generationId: randomUUID(),
      feedbackLeaseToken: key,
      feedbackLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
  // State tests seed an already applied legacy feedback; provider/recovery has its own slice.
  const complete = async (session: PracticeSession, attemptId?: string) => {
    const claim = await submit(session, randomUUID(), attemptId);
    const answer = claim.session.attempts?.at(-1);
    if (!answer) throw new Error("Missing recorded answer");
    await db.query("UPDATE practice_generation_tasks SET state='applied' WHERE attempt_id=$1", [
      answer.id,
    ]);
    await db.query(
      "UPDATE practice_attempts SET feedback='表达准确。',feedback_lease_token=NULL,feedback_lease_expires_at=NULL,current_generation_id=NULL,feedback_completed_at=now() WHERE id=$1",
      [answer.id],
    );
    await db.query(
      "UPDATE practice_sessions SET status='completed',final_feedback='表达准确。',completed_at=now(),revision=revision+1 WHERE id=$1",
      [session.id],
    );
    return workspace.get(practiceOwner, session.id);
  };
  return { db, database, workspace, teaching, repository, begin, submit, complete };
}
