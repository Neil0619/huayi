import {
  accountDataExportRecordV5Schema,
  type AccountDataExportRecordRead,
} from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import { loadBackfillState, type BackfillAccountRow } from "./postgres-shanbay-backfill-state.js";

export async function exportShanbayBackfill(
  query: AnalysisQuery,
): Promise<AccountDataExportRecordRead[]> {
  const [settings] = await query.rows<BackfillAccountRow>(
    "SELECT * FROM shanbay_backfill_accounts",
  );
  if (!settings) return [];
  const state = await loadBackfillState(query);
  return [
    {
      recordType: "shanbay-backfill-settings",
      enabled: settings.enabled,
      dailyHour: settings.daily_hour,
      revision: settings.revision,
      lastCheckedAt: settings.last_checked_at?.toISOString() ?? null,
    },
    ...Object.values(state.sources).map((source) => ({
      recordType: "shanbay-backfill-source",
      source,
    })),
    ...Object.values(state.targets).map((target) => ({
      recordType: "shanbay-backfill-target",
      target,
    })),
    ...state.batches.map(({ headwords, state, expiresAt }) => ({
      recordType: "shanbay-backfill-batch",
      batch: { headwords, state, expiresAt },
    })),
  ].map((record) => accountDataExportRecordV5Schema.parse(record));
}
