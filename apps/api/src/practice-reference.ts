import { practiceReferenceRequestSchema } from "@huayi/cloud-contracts";
import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ModelExecution } from "./model-execution.js";
import type { PaidPracticeGenerator } from "./paid-practice-generator.js";
import { createPostgresPracticeReference } from "./postgres-practice-reference.js";
import { lockPracticeOwner } from "./practice-workspace.js";
import {
  referenceContext,
  referenceDetail,
  referenceDigest,
  referenceVersionsMatch,
} from "./practice-reference-state.js";

export function createPracticeReference(
  database: AnalysisDatabase,
  generator: PaidPracticeGenerator,
) {
  const repository = createPostgresPracticeReference(database);
  return {
    async get(owner: string, id: string) {
      const read = database.snapshot?.bind(database) ?? database.transaction.bind(database);
      return read(owner, async ({ tenant }) => {
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR SHARE", [id]);
        return referenceDetail(await referenceContext(tenant, id));
      });
    },
    async generate(
      owner: string,
      id: string,
      value: unknown,
      key: string,
      execution: ModelExecution = {},
    ) {
      const input = practiceReferenceRequestSchema.parse(value);
      const claim = await repository.claim(owner, id, input, key);
      if (claim.state === "cached") return claim.session;
      const { onPreview, ...run } = execution;
      void onPreview; // Reference English is revealed only by an explicit action, never a preview.
      const output = await generator.generate({
        ...run,
        ownerUserId: owner,
        generationId: claim.generationId,
        leaseToken: claim.leaseToken,
        kind: "sentence-reference",
        input: claim.input,
      });
      if (!output) {
        const failed = await repository.failure(owner, claim.generationId);
        if (failed?.state === "failed")
          throw new CloudFault(
            failed.stable_error_code === "quota_exhausted"
              ? "quota_exhausted"
              : failed.stable_error_code === "model_output_invalid"
                ? "model_output_invalid"
                : "model_unavailable",
            "Reference generation failed.",
          );
        throw new Error("Reference generation awaits reconciliation.");
      }
      if (output.kind !== "sentence-reference") throw new Error("Reference output mismatch.");
      const { kind, ...result } = output;
      void kind;
      return repository.complete({
        ownerUserId: owner,
        sessionId: id,
        generationId: claim.generationId,
        generationLeaseToken: claim.leaseToken,
        idempotencyKey: key,
        requestHash: claim.requestHash,
        result,
      });
    },
    async reveal(owner: string, id: string, value: unknown, key: string) {
      const input = practiceReferenceRequestSchema.parse(value);
      const digest = referenceDigest({ id, ...input });
      return database.transaction(owner, async ({ tenant }) => {
        await lockPracticeOwner(tenant, owner);
        await tenant.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [id]);
        const current = await referenceContext(tenant, id);
        const previous = (
          await tenant.rows<{ request_hash: string }>(
            "SELECT request_hash FROM idempotency_records WHERE operation='practice.reference-reveal' AND key=$1",
            [key],
          )
        )[0];
        if (previous) {
          if (previous.request_hash !== digest)
            throw new CloudFault("idempotency_conflict", "Reference reveal changed.");
          return referenceDetail(current);
        }
        if (
          !current.state?.result ||
          !referenceVersionsMatch(current, input) ||
          current.availability !== "available" ||
          (current.session.attempts?.length ?? 0) !== current.ordinal
        )
          throw new CloudFault(
            "revision_conflict",
            "Practice changed. Reload before revealing the reference.",
          );
        const now = new Date().toISOString();
        if (!current.state.views.some((v) => v.ordinal === current.ordinal)) {
          current.state.views.push({ ordinal: current.ordinal, viewedAt: now });
          const teaching = current.teaching;
          if (
            teaching?.hintPolicy === "on-demand" &&
            current.workspace.mode === "guided" &&
            !teaching.round.hintViewedAt
          )
            teaching.round.hintViewedAt = now;
          current.workspace.controlRevision = (current.workspace.controlRevision ?? 0) + 1;
          await tenant.rows(
            "UPDATE practice_sessions SET reference_state=$2::jsonb,teaching_state=$3::jsonb,workspace_state=$4::jsonb,revision=revision+1,updated_at=$5 WHERE id=$1",
            [
              id,
              JSON.stringify(current.state),
              teaching ? JSON.stringify(teaching) : null,
              JSON.stringify(current.workspace),
              now,
            ],
          );
        }
        await tenant.rows(
          "INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at) VALUES($1,'practice.reference-reveal',$2,$3,$4::jsonb,now()+interval '7 days')",
          [owner, key, digest, JSON.stringify({ sessionId: id })],
        );
        return referenceDetail(await referenceContext(tenant, id));
      });
    },
  };
}
export type PracticeReference = ReturnType<typeof createPracticeReference>;
