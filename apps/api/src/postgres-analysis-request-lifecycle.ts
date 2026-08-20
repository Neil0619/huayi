import {
  analysisEventSchema,
  analysisRequestStatusSchema,
  type AnalysisEvent,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisRequestClaim, AnalysisRequestLifecycle } from "./analysis-ports.js";
import { CloudFault } from "./cloud-fault.js";
import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-analysis-protocol.js";

interface BeginRow {
  value: unknown;
}

async function parseClaim(
  value: unknown,
  command: { leaseToken: string; userId: string },
  database: AnalysisDatabase,
): Promise<AnalysisRequestClaim> {
  if (typeof value !== "object" || value === null) throw new Error("Invalid claim result.");
  const claim = value as Record<string, unknown>;
  if (claim.kind === "acquired" && typeof claim.requestId === "string") {
    return { kind: "acquired", leaseToken: command.leaseToken, requestId: claim.requestId };
  }
  if (claim.kind === "running" && typeof claim.requestId === "string") {
    return { kind: "running", requestId: claim.requestId, unitCount: Number(claim.unitCount) };
  }
  if (claim.kind === "expired" && typeof claim.requestId === "string") {
    const abandoned = await database.trusted((query) =>
      query.rows<BeginRow>("SELECT abandon_analysis_request($1,$2) AS value", [
        command.userId,
        claim.requestId,
      ]),
    );
    return {
      event: analysisEventSchema.parse(abandoned[0]?.value),
      kind: "terminal",
      requestId: claim.requestId,
    };
  }
  if (claim.kind === "terminal" && typeof claim.requestId === "string") {
    return {
      event: analysisEventSchema.parse(claim.event),
      kind: "terminal",
      requestId: claim.requestId,
    };
  }
  throw new Error("Invalid claim result.");
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("study capture not found")) {
    throw new CloudFault("not_found", "StudyCapture not found.");
  }
  if (message.includes("study capture revision conflict")) {
    throw new CloudFault("revision_conflict", "The StudyCapture revision changed.");
  }
  if (message.includes("study capture analysis busy")) {
    throw new CloudFault("generation_busy", "A StudyCapture analysis is already running.");
  }
  if (message.includes("study capture state conflict")) {
    throw new CloudFault(
      "study_capture_in_use",
      "The StudyCapture cannot be analyzed in this state.",
    );
  }
  if (message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
  }
  if (message.includes("analysis lease lost")) {
    throw new CloudFault("idempotency_conflict", "The analysis lease is no longer active.");
  }
  throw error;
}

export function createPostgresAnalysisRequestLifecycle(
  database: AnalysisDatabase,
): AnalysisRequestLifecycle {
  return {
    async attachReservation(command) {
      try {
        await database.trusted((query) =>
          query.rows("SELECT attach_analysis_reservation($1,$2,$3,$4)", [
            command.userId,
            command.requestId,
            command.leaseToken,
            command.reservationId,
          ]),
        );
      } catch (error) {
        mapDatabaseError(error);
      }
    },
    async markDispatched(command) {
      try {
        await database.trusted((query) =>
          query.rows("SELECT mark_analysis_dispatched($1,$2,$3,$4,$5,'deepseek',$6,$7,$8,$9)", [
            command.userId,
            command.requestId,
            command.leaseToken,
            command.dispatchedAt,
            command.pricing.priceVersionId,
            DEEPSEEK_PLATFORM_MODEL,
            command.pricing.prices.inputMicroUsdPerMillionTokens,
            command.pricing.prices.cachedInputMicroUsdPerMillionTokens,
            command.pricing.prices.outputMicroUsdPerMillionTokens,
          ]),
        );
      } catch (error) {
        if (error instanceof Error && error.message.includes("model price mismatch")) {
          throw new CloudFault("model_unavailable", "Model pricing is unavailable.");
        }
        mapDatabaseError(error);
      }
    },
    async begin(command) {
      try {
        const rows = await database.trusted((query) =>
          query.rows<BeginRow>("SELECT begin_analysis_request($1,$2,$3,$4,$5,$6,$7,$8) AS value", [
            command.userId,
            command.requestId,
            command.idempotencyKey,
            command.requestHash,
            command.unitCount,
            command.leaseToken,
            command.leaseExpiresAt,
            command.recoveryLedgerId,
          ]),
        );
        return parseClaim(rows[0]?.value, command, database);
      } catch (error) {
        mapDatabaseError(error);
      }
    },
    async beginCapture(command) {
      try {
        const rows = await database.trusted((query) =>
          query.rows<BeginRow>(
            "SELECT begin_capture_analysis_request($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value",
            [
              command.userId,
              command.captureId,
              command.expectedRevision,
              command.intent,
              command.requestId,
              command.idempotencyKey,
              command.requestHash,
              command.unitCount,
              command.leaseToken,
              command.leaseExpiresAt,
              command.recoveryLedgerId,
            ],
          ),
        );
        return parseClaim(rows[0]?.value, command, database);
      } catch (error) {
        mapDatabaseError(error);
      }
    },
    async get(userId, requestId) {
      const rows = await database.transaction(userId, ({ tenant }) =>
        tenant.rows<{ expired: boolean; state: string; terminal_event: unknown }>(
          "SELECT state,terminal_event,lease_expires_at<=now() AS expired FROM analysis_requests WHERE id=$1",
          [requestId],
        ),
      );
      const row = rows[0];
      if (row === undefined) return null;
      if (row.state === "running" && !row.expired) return { requestId, state: "running" };
      const terminalEvent =
        row.state === "running"
          ? (
              await database.trusted((query) =>
                query.rows<BeginRow>("SELECT abandon_analysis_request($1,$2) AS value", [
                  userId,
                  requestId,
                ]),
              )
            )[0]?.value
          : row.terminal_event;
      const event = analysisEventSchema.parse(terminalEvent);
      if (event.type === "analysis.completed") {
        return analysisRequestStatusSchema.parse({
          analysisId: event.analysis.id,
          requestId,
          state: "completed",
        });
      }
      if (event.type !== "analysis.failed") throw new Error("Invalid terminal analysis event.");
      return analysisRequestStatusSchema.parse({ error: event.error, requestId, state: "failed" });
    },
    async terminalizeWithoutReservation(command) {
      const event: AnalysisEvent = {
        error: command.error,
        quota: command.quota,
        type: "analysis.failed",
      };
      try {
        await database.trusted((query) =>
          query.rows("SELECT finish_analysis_request($1,$2,$3,$4::jsonb)", [
            command.userId,
            command.requestId,
            command.leaseToken,
            JSON.stringify(event),
          ]),
        );
      } catch (error) {
        mapDatabaseError(error);
      }
    },
  };
}
