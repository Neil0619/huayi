import {
  backfillStateSchema,
  createBackfillState,
  type BackfillState,
} from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";

export interface BackfillAccountRow {
  enabled: boolean;
  daily_hour: number;
  revision: number;
  scope_id: string;
  last_checked_at: Date | null;
}

export async function lockBackfillAccount(
  query: AnalysisQuery,
  owner: string,
): Promise<BackfillAccountRow> {
  await query.rows(
    "INSERT INTO shanbay_backfill_accounts(owner_user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [owner],
  );
  const [row] = await query.rows<BackfillAccountRow>(
    "SELECT * FROM shanbay_backfill_accounts WHERE owner_user_id=$1 FOR UPDATE",
    [owner],
  );
  if (!row) throw new Error("Backfill account is unavailable.");
  return row;
}

export async function loadBackfillState(query: AnalysisQuery): Promise<BackfillState> {
  const state = createBackfillState();
  for (const [table, field] of [
    ["shanbay_backfill_sources", "sources"],
    ["shanbay_backfill_targets", "targets"],
  ] as const) {
    const rows = await query.rows<{ headword: string; record: unknown }>(
      `SELECT headword,record FROM ${table} ORDER BY headword`,
    );
    Object.assign(state[field], Object.fromEntries(rows.map((row) => [row.headword, row.record])));
  }
  const batches = await query.rows<{ record: unknown }>(
    "SELECT record FROM shanbay_backfill_batches ORDER BY token",
  );
  return backfillStateSchema.parse({ ...state, batches: batches.map((row) => row.record) });
}

export async function saveBackfillState(
  query: AnalysisQuery,
  owner: string,
  before: BackfillState,
  state: BackfillState,
): Promise<void> {
  const validated = backfillStateSchema.parse(state);
  for (const [table, field] of [
    ["shanbay_backfill_sources", "sources"],
    ["shanbay_backfill_targets", "targets"],
  ] as const) {
    const changed = Object.entries(validated[field])
      .filter(([key, record]) => JSON.stringify(before[field][key]) !== JSON.stringify(record))
      .map(([headword, record]) => ({ headword, record }));
    // Keep each statement bounded while avoiding a network round trip per changed word.
    for (let index = 0; index < changed.length; index += 100) {
      await query.rows(
        `INSERT INTO ${table}(owner_user_id,headword,record)
         SELECT $1::uuid,headword,record FROM jsonb_to_recordset($2::jsonb) AS entries(headword text,record jsonb)
         ON CONFLICT(owner_user_id,headword) DO UPDATE SET record=excluded.record`,
        [owner, JSON.stringify(changed.slice(index, index + 100))],
      );
    }
  }
  const previous = new Map(before.batches.map((batch) => [batch.token, JSON.stringify(batch)]));
  for (const batch of validated.batches) {
    if (previous.get(batch.token) === JSON.stringify(batch)) continue;
    await query.rows(
      "INSERT INTO shanbay_backfill_batches(owner_user_id,token,record) VALUES($1,$2,$3::jsonb) ON CONFLICT(owner_user_id,token) DO UPDATE SET record=excluded.record",
      [owner, batch.token, JSON.stringify(batch)],
    );
  }
}
