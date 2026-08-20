import type { AnalysisQuery } from "./analysis-database.js";
import type { ImportedWordbookEntry } from "./external-wordbook-module.js";
import { CloudFault } from "./cloud-fault.js";

export async function applyEudicImportPage(
  tenant: AnalysisQuery,
  input: {
    entries: readonly ImportedWordbookEntry[];
    jobId: string;
    now: string;
    ownerUserId: string;
    page: number;
  },
): Promise<void> {
  for (const entry of input.entries) {
    const inserted = await tenant.rows<{ id: string }>(
      `INSERT INTO word_entries(
         id,owner_user_id,headword,canonical_key,notes,created_at,updated_at
       ) VALUES($1,$2,$3,$4,NULL,$5,$5)
       ON CONFLICT(owner_user_id,canonical_key) DO NOTHING RETURNING id::text`,
      [entry.wordId, input.ownerUserId, entry.headword, entry.canonicalKey, input.now],
    );
    const words = await tenant.rows<{ id: string }>(
      "SELECT id::text FROM word_entries WHERE canonical_key=$1 FOR UPDATE",
      [entry.canonicalKey],
    );
    const wordId = words[0]?.id;
    if (wordId === undefined) throw new CloudFault("not_found", "Imported word was not found.");
    if (
      entry.contextId !== undefined &&
      entry.contentHash !== undefined &&
      entry.sourceText !== undefined
    ) {
      const contexts = await tenant.rows<{ id: string }>(
        `INSERT INTO context_observations(
           id,owner_user_id,word_entry_id,content_hash,source_text,source_type,observed_at,
           created_at,updated_at
         ) VALUES($1,$2,$3,$4,$5,'eudic',$6,$7,$7)
         ON CONFLICT(owner_user_id,word_entry_id,content_hash) DO NOTHING RETURNING id::text`,
        [
          entry.contextId,
          input.ownerUserId,
          wordId,
          entry.contentHash,
          entry.sourceText,
          entry.observedAt,
          input.now,
        ],
      );
      if (contexts.length > 0 && inserted.length === 0) {
        await tenant.rows("UPDATE word_entries SET revision=revision+1,updated_at=$2 WHERE id=$1", [
          wordId,
          input.now,
        ]);
      }
    }
    await tenant.rows(
      `INSERT INTO external_wordbook_items(
         id,owner_user_id,job_id,word_entry_id,payload_snapshot,state,attempt_count,receipt,
         created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5::jsonb,'delivered',1,$6::jsonb,$7,$7)
       ON CONFLICT(job_id,word_entry_id) DO NOTHING`,
      [
        entry.itemId,
        input.ownerUserId,
        input.jobId,
        wordId,
        JSON.stringify({
          headword: entry.headword,
          ...(entry.sourceText === undefined ? {} : { contextLine: entry.sourceText }),
        }),
        JSON.stringify({
          outcome: inserted.length > 0 ? "created" : "already-present",
          recordedAt: input.now,
          target: "eudic",
        }),
        input.now,
      ],
    );
  }
  const nextPage = input.page + 1;
  const state =
    input.entries.length < 100
      ? "completed"
      : input.page === 50
        ? "source-limit-reached"
        : "active";
  await tenant.rows(
    `UPDATE external_wordbook_jobs SET state=$2,next_page=$3,last_error_code=NULL,
       lease_nonce_hash=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=$4
     WHERE id=$1`,
    [input.jobId, state, nextPage, input.now],
  );
}
