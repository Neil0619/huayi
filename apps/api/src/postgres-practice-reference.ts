import { randomUUID } from "node:crypto";
import {
  practiceReferenceResultSchema,
  type PracticeReferenceRequest,
  type PracticeReferenceResult,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { loadPracticeSession, requireActivePracticeItem } from "./postgres-practice-view.js";
import { lockPracticeOwner } from "./practice-workspace.js";
import {
  referenceContext,
  referenceDigest,
  referenceVersionsMatch,
  type ReferenceState,
} from "./practice-reference-state.js";
import { practiceGenerationOutputSchema } from "./practice-generation-output.js";

interface Generation {
  id: string;
  state: string;
  lease_token: string;
  lease_expires_at: Date;
  stable_error_code: string | null;
  output?: unknown;
  applied_output_hash?: string | null;
}
interface Receipt {
  request_hash: string;
  response: { generationId: string; sessionId: string; state: "pending" | "applied" };
}
function fail(): never {
  throw new CloudFault("revision_conflict", "Practice changed. Reload the saved practice.");
}
async function receipt(
  query: AnalysisQuery,
  owner: string,
  id: string,
  key: string,
  digest: string,
  generationId: string,
  session: PracticeSession,
  applied: boolean,
) {
  await query.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
    VALUES($1,'practice.reference',$2,$3,$4::jsonb,now()+interval '7 days')
    ON CONFLICT(owner_user_id,operation,key) DO UPDATE SET response=EXCLUDED.response`,
    [
      owner,
      key,
      digest,
      JSON.stringify({
        type: "practice-reference-receipt",
        version: 1,
        sessionId: id,
        generationId,
        state: applied ? "applied" : "pending",
        ...(applied ? { session } : {}),
      }),
    ],
  );
}

export function createPostgresPracticeReference(database: AnalysisDatabase) {
  return {
    async claim(owner: string, id: string, input: PracticeReferenceRequest, key: string) {
      const digest = referenceDigest({ id, ...input });
      return database.transaction(owner, async ({ tenant }) => {
        await lockPracticeOwner(tenant, owner);
        const links = await tenant.rows<{ learning_item_id: string }>(
          "SELECT learning_item_id FROM practice_session_items WHERE session_id=$1 ORDER BY position",
          [id],
        );
        if (!links[0]) throw new CloudFault("not_found", "Practice session not found.");
        await requireActivePracticeItem(tenant, links[0].learning_item_id, { lock: true });
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [id]);
        const current = await referenceContext(tenant, id);
        const previous = (
          await tenant.rows<Receipt>(
            "SELECT request_hash,response FROM idempotency_records WHERE operation='practice.reference' AND key=$1",
            [key],
          )
        )[0];
        if (previous && previous.request_hash !== digest)
          throw new CloudFault("idempotency_conflict", "Reference request changed.");
        if (previous?.response.state === "applied")
          return { state: "cached" as const, session: current.session };
        if (current.state?.result) {
          await receipt(
            tenant,
            owner,
            id,
            key,
            digest,
            current.state.generationId,
            current.session,
            true,
          );
          return { state: "cached" as const, session: current.session };
        }
        if (
          !current.input ||
          !current.identity ||
          current.availability !== "available" ||
          !referenceVersionsMatch(current, input)
        )
          fail();
        let generation: Generation | undefined;
        if (current.state)
          generation = (
            await tenant.rows<Generation>(
              "SELECT id,state,lease_token,lease_expires_at,stable_error_code FROM practice_generation_tasks WHERE id=$1 AND session_id=$2 FOR UPDATE",
              [current.state.generationId, id],
            )
          )[0];
        if (previous && previous.response.generationId !== generation?.id) fail();
        if (generation?.state === "abandoned")
          throw new CloudFault("generation_busy", "The previous reference outcome is unresolved.");
        if (previous && generation?.state === "failed")
          throw new CloudFault(
            generation.stable_error_code === "quota_exhausted"
              ? "quota_exhausted"
              : generation.stable_error_code === "model_output_invalid"
                ? "model_output_invalid"
                : "model_unavailable",
            "The saved reference request failed.",
          );
        if (!generation || ["failed", "applied"].includes(generation.state)) {
          const open = await tenant.rows(
            "SELECT id FROM practice_generation_tasks WHERE session_id=$1 AND state IN ('claimed','reserved','dispatched','ready') LIMIT 1",
            [id],
          );
          if (open.length)
            throw new CloudFault("generation_busy", "Another practice generation is in progress.");
          generation = {
            id: randomUUID(),
            state: "claimed",
            lease_token: randomUUID(),
            lease_expires_at: new Date(Date.now() + 180_000),
            stable_error_code: null,
          };
          await tenant.rows(
            `INSERT INTO practice_generation_tasks(id,owner_user_id,session_id,kind,state,request_hash,lease_token,lease_expires_at)
            VALUES($1,$2,$3,'sentence-reference','claimed',$4,$5,$6)`,
            [generation.id, owner, id, digest, generation.lease_token, generation.lease_expires_at],
          );
          const state: ReferenceState = {
            version: 1,
            identity: current.identity,
            generationId: generation.id,
            result: null,
            views: [],
          };
          await tenant.rows(
            "UPDATE practice_sessions SET reference_state=$2::jsonb,current_generation_id=$3 WHERE id=$1",
            [id, JSON.stringify(state), generation.id],
          );
        } else if (
          ["claimed", "reserved"].includes(generation.state) &&
          generation.lease_expires_at.getTime() <= Date.now()
        ) {
          generation.lease_token = randomUUID();
          await tenant.rows(
            "UPDATE practice_generation_tasks SET lease_token=$2,lease_expires_at=$3 WHERE id=$1",
            [generation.id, generation.lease_token, new Date(Date.now() + 180_000)],
          );
        }
        await receipt(tenant, owner, id, key, digest, generation.id, current.session, false);
        return {
          state: "claimed" as const,
          session: current.session,
          requestHash: digest,
          generationId: generation.id,
          leaseToken: generation.lease_token,
          input: current.input,
        };
      });
    },
    async complete(command: {
      ownerUserId: string;
      sessionId: string;
      generationId: string;
      generationLeaseToken: string;
      idempotencyKey: string;
      requestHash: string;
      result: PracticeReferenceResult;
    }) {
      const result = practiceReferenceResultSchema.parse(command.result);
      return database.transaction(command.ownerUserId, async ({ tenant }) => {
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [
          command.sessionId,
        ]);
        const current = await referenceContext(tenant, command.sessionId);
        const saved = (
          await tenant.rows<Receipt>(
            "SELECT request_hash,response FROM idempotency_records WHERE operation='practice.reference' AND key=$1",
            [command.idempotencyKey],
          )
        )[0];
        if (
          !saved ||
          saved.request_hash !== command.requestHash ||
          saved.response.generationId !== command.generationId ||
          saved.response.sessionId !== command.sessionId
        )
          fail();
        const generation = (
          await tenant.rows<Generation>(
            "SELECT id,state,lease_token,lease_expires_at,stable_error_code,output,applied_output_hash FROM practice_generation_tasks WHERE id=$1 AND session_id=$2 AND kind='sentence-reference' FOR UPDATE",
            [command.generationId, command.sessionId],
          )
        )[0];
        if (
          !generation ||
          generation.lease_token !== command.generationLeaseToken ||
          !["ready", "applied"].includes(generation.state)
        )
          fail();
        const hash = referenceDigest(result);
        if (generation.state === "applied" && generation.applied_output_hash !== hash) fail();
        if (generation.state === "ready") {
          const stored = practiceGenerationOutputSchema.parse(generation.output);
          if (stored.kind !== "sentence-reference") fail();
          const { kind, ...storedResult } = stored;
          void kind;
          if (referenceDigest(storedResult) !== hash) fail();
          if (current.state?.generationId === command.generationId) {
            const state = { ...current.state, result };
            await tenant.rows(
              "UPDATE practice_sessions SET reference_state=$2::jsonb WHERE id=$1",
              [command.sessionId, JSON.stringify(state)],
            );
          }
          await tenant.rows(
            "UPDATE practice_generation_tasks SET state='applied',output=NULL,applied_output_hash=$2,updated_at=now() WHERE id=$1",
            [command.generationId, hash],
          );
          await tenant.rows(
            "UPDATE practice_sessions SET current_generation_id=NULL WHERE id=$1 AND current_generation_id=$2",
            [command.sessionId, command.generationId],
          );
        }
        const session = await loadPracticeSession(tenant, command.sessionId);
        await receipt(
          tenant,
          command.ownerUserId,
          command.sessionId,
          command.idempotencyKey,
          command.requestHash,
          command.generationId,
          session,
          true,
        );
        return session;
      });
    },
    async failure(owner: string, id: string) {
      return database.transaction(
        owner,
        async ({ tenant }) =>
          (
            await tenant.rows<{ state: string; stable_error_code: string | null }>(
              "SELECT state,stable_error_code FROM practice_generation_tasks WHERE id=$1",
              [id],
            )
          )[0],
      );
    },
  };
}
