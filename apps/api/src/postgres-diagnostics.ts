import {
  diagnosticEventSchema,
  diagnosticListSchema,
  type DiagnosticQuery,
} from "@huayi/cloud-contracts";
import { createAdminOperationsCursor } from "./admin-operations-cursor.js";
import type { AdminAuthorization } from "./admin-operations-module.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { DiagnosticWriter } from "./diagnostic-context.js";
import { requireRecent, translateAdminError } from "./postgres-admin-operations-support.js";

export function createPostgresDiagnostics(database: AnalysisDatabase, key: Uint8Array) {
  const cursor = createAdminOperationsCursor(key);
  const write: DiagnosticWriter = async (records) => {
    const owners = new Set(records.map((record) => record.userId));
    for (const owner of owners) {
      const events = records
        .filter((record) => record.userId === owner)
        .map((record) => diagnosticEventSchema.parse(record.event));
      await database.trusted((query) =>
        query.rows("SELECT record_error_diagnostics($1,$2::jsonb)", [
          owner,
          JSON.stringify(events),
        ]),
      );
    }
  };
  return {
    write,
    async purge() {
      await database.trusted((query) => query.rows("SELECT purge_error_diagnostics()"));
    },
    async list(authorization: AdminAuthorization, filters: DiagnosticQuery) {
      requireRecent(authorization, new Date());
      const boundary = filters.cursor ? cursor.decode(filters.cursor, "error-logs") : null;
      const limit = filters.limit ?? 30;
      try {
        const rows = await database.trusted((query) =>
          query.rows<{ result: unknown }>(
            "SELECT admin_error_diagnostics($1,$2::jsonb,$3::jsonb,$4) AS result",
            [
              authorization.actorUserId,
              JSON.stringify(filters),
              boundary === null ? null : JSON.stringify(boundary),
              limit + 1,
            ],
          ),
        );
        const result = diagnosticListSchema
          .extend({ items: diagnosticListSchema.shape.items.max(101) })
          .parse({ ...(rows[0]?.result as object), nextCursor: null });
        const items = result.items.slice(0, limit);
        const last = items.at(-1);
        return diagnosticListSchema.parse({
          ...result,
          items,
          nextCursor:
            result.items.length > limit && last
              ? cursor.encode("error-logs", { createdAt: last.receivedAt, id: last.event.id })
              : null,
        });
      } catch (error) {
        return translateAdminError(error);
      }
    },
  };
}
