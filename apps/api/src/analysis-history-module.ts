import {
  analysisHistoryResponseSchema,
  analysisRecordSchema,
  listAnalysesQuerySchema,
  type AnalysisDeleteResponse,
  type AnalysisRecord,
  type ListAnalysesQuery,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import { createAnalysisHistoryCursor } from "./analysis-history-cursor.js";
import type { AnalysisRepository } from "./analysis-ports.js";
import type { Clock } from "./security.js";

export interface AnalysisHistoryMutationCommand {
  deleteStudyCapture?: boolean;
  expectedRevision: number;
  id: string;
  idempotencyKey: string;
  userId: string;
}

export function createAnalysisHistoryModule(dependencies: {
  clock: Clock;
  cursorKey: Uint8Array;
  repository: AnalysisRepository;
}) {
  const cursor = createAnalysisHistoryCursor(dependencies.cursorKey);

  const mutation = <Result extends AnalysisDeleteResponse | AnalysisRecord>(
    operation: "archive" | "delete" | "processNothingToSave" | "restore",
    command: AnalysisHistoryMutationCommand,
  ): Promise<Result> => {
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          expectedRevision: command.expectedRevision,
          ...(command.deleteStudyCapture === undefined
            ? {}
            : { deleteStudyCapture: command.deleteStudyCapture }),
          id: command.id,
          operation,
        }),
      )
      .digest("hex");
    return dependencies.repository[operation]({
      ...command,
      requestHash,
      updatedAt: dependencies.clock.now().toISOString(),
    }) as Promise<Result>;
  };

  return {
    archiveAnalysis: (command: AnalysisHistoryMutationCommand) =>
      mutation<AnalysisRecord>("archive", command),
    deleteAnalysis: (command: AnalysisHistoryMutationCommand) =>
      mutation<AnalysisDeleteResponse>("delete", command),
    getAnalysis: (userId: string, id: string) => dependencies.repository.findById(userId, id),
    async listAnalyses(userId: string, input: ListAnalysesQuery) {
      const query = listAnalysesQuerySchema.parse(input);
      const page = await dependencies.repository.list(userId, {
        archived: query.archived,
        ...(query.cursor === undefined ? {} : { boundary: cursor.decode(query.cursor) }),
        limit: query.limit,
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.reviewState === undefined ? {} : { reviewState: query.reviewState }),
        ...(query.selectionKind === undefined ? {} : { selectionKind: query.selectionKind }),
        ...(query.sourceType === undefined ? {} : { sourceType: query.sourceType }),
      });
      const last = page.items.at(-1);
      return analysisHistoryResponseSchema.parse({
        items: page.items,
        nextCursor:
          page.hasMore && last !== undefined
            ? cursor.encode({ createdAt: last.createdAt, id: last.id })
            : null,
      });
    },
    processNothingToSave: (command: AnalysisHistoryMutationCommand) =>
      mutation<AnalysisRecord>("processNothingToSave", command).then((value) =>
        analysisRecordSchema.parse(value),
      ),
    restoreAnalysis: (command: AnalysisHistoryMutationCommand) =>
      mutation<AnalysisRecord>("restore", command),
  };
}
