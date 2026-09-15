import {
  backfillHeadwordSchema,
  confirmBackfillTargets,
  discoverBackfill,
  expireBackfillBatches,
  type BackfillState,
} from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import {
  loadBackfillState,
  lockBackfillAccount,
  saveBackfillState,
} from "./postgres-shanbay-backfill-state.js";

interface LegacyItem {
  id: string;
  job_id: string;
  headword: string;
  state: string;
  receipt: unknown;
  lease_nonce_hash: string | null;
  lease_expires_at: Date | null;
}
export async function synchronizeLegacyBackfill(
  query: AnalysisQuery,
  state: BackfillState,
  now: string,
): Promise<void> {
  const items = await query.rows<LegacyItem>(
    `SELECT items.id::text,items.job_id::text,lower(trim(items.payload_snapshot->>'headword')) headword,items.state,items.receipt,jobs.lease_nonce_hash,jobs.lease_expires_at FROM external_wordbook_items items JOIN external_wordbook_jobs jobs ON jobs.id=items.job_id WHERE jobs.target='shanbay' AND jobs.direction='export' ORDER BY items.id`,
  );
  const jobs = new Set<string>();
  for (const item of items) {
    if (!backfillHeadwordSchema.safeParse(item.headword).success) continue;
    const receipt = item.receipt as { outcome?: unknown; target?: unknown } | null;
    if (
      item.state === "delivered" &&
      receipt?.target === "shanbay" &&
      receipt.outcome === "confirmed"
    )
      confirmBackfillTargets(state, [item.headword], now);
    if (["pending", "failed", "in-flight"].includes(item.state))
      discoverBackfill(state, [item.headword], "cloud", now);
    if (item.state === "in-flight" && item.lease_nonce_hash && item.lease_expires_at) {
      const token = `legacy:${item.job_id}:${item.lease_nonce_hash}`;
      let batch = state.batches.find((batch) => batch.token === token);
      if (!batch) {
        batch = {
          token,
          holder: "legacy",
          headwords: [],
          state: "prepared",
          expiresAt: item.lease_expires_at.toISOString(),
        };
        state.batches.push(batch);
      }
      if (!batch.headwords.includes(item.headword)) batch.headwords.push(item.headword);
    }
    const target = Object.hasOwn(state.targets, item.headword)
      ? state.targets[item.headword]
      : undefined;
    if (target?.confirmedAt && ["pending", "failed", "in-flight"].includes(item.state)) {
      await query.rows(
        "UPDATE external_wordbook_items SET state='delivered',stable_error_code=NULL,receipt=$2::jsonb,updated_at=$3 WHERE id=$1",
        [
          item.id,
          JSON.stringify({
            target: "shanbay",
            outcome: "confirmed",
            recordedAt: target.confirmedAt,
          }),
          now,
        ],
      );
      jobs.add(item.job_id);
    }
  }
  for (const batch of state.batches) {
    if (batch.holder !== "legacy" || batch.state === "resolved") continue;
    const live = items.filter(
      (item) =>
        `legacy:${item.job_id}:${item.lease_nonce_hash}` === batch.token &&
        item.state === "in-flight",
    );
    if (live.length === 0) {
      if (batch.headwords.every((word) => state.targets[word]?.confirmedAt != null))
        batch.state = "resolved";
      else batch.state = "unknown";
    }
  }
  expireBackfillBatches(state, now);
  for (const jobId of jobs)
    await query.rows(
      `UPDATE external_wordbook_jobs jobs SET state=CASE WHEN EXISTS(SELECT 1 FROM external_wordbook_items WHERE job_id=jobs.id AND state IN ('pending','in-flight')) THEN 'active' WHEN EXISTS(SELECT 1 FROM external_wordbook_items WHERE job_id=jobs.id AND state='failed') THEN 'failed' ELSE 'completed' END,revision=revision+1,updated_at=$2 WHERE id=$1 AND state<>'cancelled'`,
      [jobId, now],
    );
}

export async function prepareLegacyBackfill(query: AnalysisQuery, owner: string, now: string) {
  await lockBackfillAccount(query, owner);
  const state = await loadBackfillState(query);
  const before = structuredClone(state);
  await synchronizeLegacyBackfill(query, state, now);
  await saveBackfillState(query, owner, before, state);
  return state;
}
export function legacyBackfillBlocked(state: BackfillState): string[] {
  return [
    ...new Set(
      state.batches
        .filter((batch) => batch.state !== "resolved")
        .flatMap((batch) => batch.headwords),
    ),
  ];
}
