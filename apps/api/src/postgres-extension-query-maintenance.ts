import { extensionQueryCleanupResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { ExtensionQueryMaintenance } from "./extension-query-maintenance.js";

const BATCH_LIMIT = 100;

export function createPostgresExtensionQueryMaintenance(options: {
  database: AnalysisDatabase;
  ledgerId: () => string;
}): ExtensionQueryMaintenance {
  return {
    async runBatch() {
      const ledgerIds = Array.from({ length: BATCH_LIMIT }, () => options.ledgerId());
      const rows = await options.database.trusted((query) =>
        query.rows<{ abandoned_count: number | string; deleted_count: number | string }>(
          "SELECT * FROM cleanup_extension_queries($1::uuid[])",
          [ledgerIds],
        ),
      );
      const result = rows[0];
      if (result === undefined) throw new Error("Extension query cleanup returned no result.");
      return extensionQueryCleanupResponseSchema.parse({
        abandonedCount: Number(result.abandoned_count),
        deletedCount: Number(result.deleted_count),
      });
    },
  };
}
