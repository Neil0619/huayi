import type { AnalysisDatabase } from "./analysis-database.js";

const BATCH_LIMIT = 100;

export interface DuplicateSuggestionMaintenanceResult {
  abandonedCount: number;
  deletedCount: number;
}

export function createPostgresDuplicateSuggestionMaintenance(options: {
  database: AnalysisDatabase;
  ledgerId(): string;
  now(): Date;
}) {
  return {
    async runBatch(): Promise<DuplicateSuggestionMaintenanceResult> {
      const ledgerIds = Array.from({ length: BATCH_LIMIT }, () => options.ledgerId());
      const rows = await options.database.trusted((query) =>
        query.rows<{ abandoned_count: number | string; deleted_count: number | string }>(
          "SELECT * FROM cleanup_duplicate_suggestion_requests($1::uuid[],$2)",
          [ledgerIds, options.now()],
        ),
      );
      const row = rows[0];
      if (row === undefined) throw new Error("Duplicate suggestion cleanup returned no result.");
      return {
        abandonedCount: Number(row.abandoned_count),
        deletedCount: Number(row.deleted_count),
      };
    },
  };
}
