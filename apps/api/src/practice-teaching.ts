import { createHash } from "node:crypto";
import { practiceTeachingActionSchema } from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { loadPracticeSession, requireActivePracticeItem } from "./postgres-practice-view.js";
import {
  loadPracticeTeaching,
  readPracticeTeachingState,
} from "./postgres-practice-teaching-view.js";
import {
  lockPracticeOwner,
  practiceWorkspaceState,
  requirePracticeWorkspaceAvailable,
} from "./practice-workspace.js";

function conflict(): never {
  throw new CloudFault("revision_conflict", "Practice changed. Reload the saved practice.");
}
async function lockSession(query: AnalysisQuery, id: string) {
  await query.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [id]);
}

export function createPracticeTeaching(database: AnalysisDatabase) {
  return {
    async get(owner: string, id: string) {
      if (database.snapshot)
        return database.snapshot(owner, ({ tenant }) => loadPracticeTeaching(tenant, id));
      // Small embedded test adapters have no snapshot API. A shared row lock still
      // excludes every session/attempt/teaching writer across these SELECTs.
      return database.transaction(owner, async ({ tenant }) => {
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR SHARE", [id]);
        return loadPracticeTeaching(tenant, id);
      });
    },
    async act(owner: string, id: string, input: unknown, key: string) {
      const request = practiceTeachingActionSchema.parse(input);
      const digest = createHash("sha256")
        .update(JSON.stringify({ id, ...request }))
        .digest("hex");
      return database.transaction(owner, async ({ tenant }) => {
        await lockPracticeOwner(tenant, owner);
        const previous = (
          await tenant.rows<{ request_hash: string }>(
            "SELECT request_hash FROM idempotency_records WHERE operation='practice.teaching' AND key=$1",
            [key],
          )
        )[0];
        if (previous) {
          if (previous.request_hash !== digest)
            throw new CloudFault(
              "idempotency_conflict",
              "This practice key belongs to another action.",
            );
          await lockSession(tenant, id);
          return loadPracticeTeaching(tenant, id);
        }
        // Learning-item erasure also locks item -> session. Read the immutable link
        // first, then use that same order; never acquire the item after the session.
        if (request.action === "rewrite") {
          const links = await tenant.rows<{ learning_item_id: string }>(
            "SELECT learning_item_id FROM practice_session_items WHERE session_id=$1 ORDER BY position",
            [id],
          );
          if (!links[0]) throw new CloudFault("not_found", "Practice session not found.");
          await requireActivePracticeItem(tenant, links[0].learning_item_id, { lock: true });
        }
        await lockSession(tenant, id);
        const session = await loadPracticeSession(tenant, id);
        const state = await readPracticeTeachingState(tenant, id);
        const workspace = practiceWorkspaceState(session);
        if (
          !state ||
          state.target.state !== "available" ||
          workspace.phase !== "active" ||
          session.revision !== request.expectedRevision ||
          (workspace.controlRevision ?? 0) !== request.expectedControlRevision
        )
          conflict();
        const now = new Date().toISOString();
        if (request.action === "rewrite") {
          const answers = session.attempts ?? [];
          const latest = answers.at(-1);
          if (
            session.status !== "completed" ||
            !latest?.feedback ||
            !session.finalFeedback ||
            latest.feedback !== session.finalFeedback ||
            answers.length >= 5 ||
            state.round.ordinal !== answers.length - 1 ||
            request.expectedDraftRevision !== workspace.draftRevision
          )
            conflict();
          await requirePracticeWorkspaceAvailable(tenant, id);
          const pending = await tenant.rows(
            "SELECT id FROM practice_generation_tasks WHERE session_id=$1 AND state IN ('claimed','reserved','dispatched','ready') LIMIT 1",
            [id],
          );
          if (pending.length || session.pendingGeneration) conflict();
          state.round = { ordinal: answers.length, parentAttemptId: latest.id, hintViewedAt: null };
          workspace.draft = latest.answer;
          workspace.draftRevision += 1;
          workspace.controlRevision = (workspace.controlRevision ?? 0) + 1;
          await tenant.rows(
            "UPDATE practice_sessions SET status='active',final_feedback=NULL,completed_at=NULL,teaching_state=$2::jsonb,workspace_state=$3::jsonb,revision=revision+1,updated_at=$4 WHERE id=$1",
            [id, JSON.stringify(state), JSON.stringify(workspace), now],
          );
        } else {
          if (
            session.status !== "active" ||
            workspace.mode !== "guided" ||
            state.hintPolicy !== "on-demand" ||
            state.round.ordinal !== request.ordinal ||
            (session.attempts?.length ?? 0) !== state.round.ordinal
          )
            conflict();
          if (state.round.hintViewedAt === null) {
            state.round.hintViewedAt = now;
            workspace.controlRevision = (workspace.controlRevision ?? 0) + 1;
            await tenant.rows(
              "UPDATE practice_sessions SET teaching_state=$2::jsonb,workspace_state=$3::jsonb,revision=revision+1,updated_at=$4 WHERE id=$1",
              [id, JSON.stringify(state), JSON.stringify(workspace), now],
            );
          }
        }
        // An opaque receipt cannot retain a deleted target snapshot. Every replay
        // loads the current owner-scoped state, including its deletion revision.
        await tenant.rows(
          "INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at) VALUES($1,'practice.teaching',$2,$3,$4::jsonb,$5::timestamptz)",
          [
            owner,
            key,
            digest,
            JSON.stringify({ sessionId: id }),
            new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
          ],
        );
        return loadPracticeTeaching(tenant, id);
      });
    },
  };
}
export type PracticeTeaching = ReturnType<typeof createPracticeTeaching>;
