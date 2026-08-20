import { confirmCandidatesResponseSchema } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { CandidateConfirmationReplayCommand } from "./analysis-ports.js";
import { CloudFault } from "./cloud-fault.js";

export async function replayPostgresCandidateConfirmation(
  database: AnalysisDatabase,
  command: CandidateConfirmationReplayCommand,
) {
  try {
    return await database.transaction(command.userId, async ({ trusted }) => {
      const rows = await trusted.rows<{ response: unknown }>(
        "SELECT begin_idempotent_write($1,'analysis.confirm',$2,$3) AS response",
        [command.userId, command.idempotencyKey, command.requestHash],
      );
      return rows[0]?.response == null
        ? null
        : confirmCandidatesResponseSchema.parse(rows[0].response);
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("idempotency conflict")) {
      throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
    }
    throw error;
  }
}
