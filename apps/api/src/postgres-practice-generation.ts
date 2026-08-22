import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisQuota } from "./analysis-ports.js";
import { CloudFault } from "./cloud-fault.js";
import type {
  PracticeGenerationKind,
  PracticeGenerationRepository,
} from "./paid-practice-generator.js";
import { settleFailedPracticeGeneration } from "./postgres-practice-generation-settlement.js";
import type { DeepSeekPriceSchedule } from "./deepseek-price-schedule.js";
import { DEEPSEEK_PLATFORM_MODEL } from "./deepseek-analysis-protocol.js";

interface TaskRow {
  attempt_id: string | null;
  kind: PracticeGenerationKind;
  lease_expires_at: Date;
  lease_token: string;
  output: unknown;
  price_version_id: string | null;
  reservation_id: string | null;
  reserved_micro_usd: string;
  session_id: string;
  state: "abandoned" | "applied" | "claimed" | "dispatched" | "failed" | "ready" | "reserved";
}

export function createPostgresPracticeGenerationRepository(options: {
  database: AnalysisDatabase;
  ledgerId(): string;
  priceVersionId: string;
  pricing?: DeepSeekPriceSchedule;
  quota: AnalysisQuota;
  reservedMicroUsd: number | ((kind: PracticeGenerationKind) => number);
  now(): Date;
}): PracticeGenerationRepository {
  const task = async (ownerUserId: string, generationId: string) =>
    options.database.transaction(ownerUserId, async ({ tenant }) => {
      const rows = await tenant.rows<TaskRow>(
        `SELECT kind,state,session_id::text,attempt_id::text,lease_token,lease_expires_at,
          reservation_id::text,price_version_id::text,reserved_micro_usd::text,output
          FROM practice_generation_tasks
          WHERE id=$1 FOR UPDATE`,
        [generationId],
      );
      return rows[0];
    });

  const failClaimed = async (
    command: { generationId: string; leaseToken: string; ownerUserId: string },
    stableErrorCode: "model_unavailable" | "quota_exhausted",
  ) =>
    options.database.transaction(command.ownerUserId, async ({ tenant }) => {
      const rows = await tenant.rows<{ attempt_id: string | null; session_id: string }>(
        `UPDATE practice_generation_tasks SET state='failed',stable_error_code=$3,updated_at=$4
          WHERE id=$1 AND lease_token=$2 AND state='claimed'
          RETURNING session_id::text,attempt_id::text`,
        [command.generationId, command.leaseToken, stableErrorCode, options.now()],
      );
      const failed = rows[0];
      if (failed === undefined) return;
      await tenant.rows(
        `UPDATE practice_sessions SET current_generation_id=NULL,generation_lease_token=NULL,
          generation_lease_expires_at=NULL,updated_at=$3
          WHERE id=$1 AND current_generation_id=$2`,
        [failed.session_id, command.generationId, options.now()],
      );
      if (failed.attempt_id !== null) {
        await tenant.rows(
          `UPDATE practice_attempts SET current_generation_id=NULL,feedback_lease_token=NULL,
            feedback_lease_expires_at=NULL,updated_at=$3
            WHERE id=$1 AND current_generation_id=$2`,
          [failed.attempt_id, command.generationId, options.now()],
        );
      }
    });

  return {
    async acquire(command) {
      const current = await task(command.ownerUserId, command.generationId);
      if (current === undefined || current.kind !== command.kind) {
        throw new CloudFault("revision_conflict", "Practice generation changed.");
      }
      if (current.lease_token !== command.leaseToken) return { kind: "pending" };
      if (current.state === "ready") {
        return { kind: "ready", output: practiceGenerationOutputSchema.parse(current.output) };
      }
      if (current.state === "dispatched") {
        if (current.lease_expires_at.getTime() > options.now().getTime()) {
          return { kind: "pending" };
        }
        if (current.reservation_id === null || current.price_version_id === null) {
          throw new CloudFault("revision_conflict", "Practice generation reservation is missing.");
        }
        const operationTime = options.now();
        await options.database.transaction(command.ownerUserId, (queries) =>
          settleFailedPracticeGeneration(queries, {
            ...command,
            ledgerId: options.ledgerId,
            leaseExpiredAt: operationTime,
            now: operationTime,
            reservationId: current.reservation_id ?? "",
            stableErrorCode: "model_unavailable",
            terminalState: "abandoned",
          }),
        );
        return { kind: "pending" };
      }
      if (current.state === "reserved" && current.reservation_id !== null) {
        return { kind: "acquired", reservationId: current.reservation_id };
      }
      if (current.state !== "claimed") return { kind: "pending" };
      let reservation: { id: string };
      const reservedMicroUsd =
        typeof options.reservedMicroUsd === "function"
          ? options.reservedMicroUsd(command.kind)
          : options.reservedMicroUsd;
      try {
        reservation = await options.quota.reserve({
          requestId: command.generationId,
          reservedMicroUsd,
          userId: command.ownerUserId,
        });
      } catch (error) {
        await failClaimed(
          command,
          error instanceof CloudFault && error.code === "quota_exhausted"
            ? "quota_exhausted"
            : "model_unavailable",
        );
        throw error;
      }
      const attached = await options.database.transaction(command.ownerUserId, ({ tenant }) =>
        tenant.rows<{ id: string }>(
          `UPDATE practice_generation_tasks SET state='reserved',reservation_id=$3,
            price_version_id=$4,reserved_micro_usd=$5,updated_at=now()
            WHERE id=$1 AND lease_token=$2 AND state='claimed' RETURNING id::text`,
          [
            command.generationId,
            command.leaseToken,
            reservation.id,
            options.pricing === undefined ? options.priceVersionId : null,
            reservedMicroUsd,
          ],
        ),
      );
      if (attached[0] !== undefined) return { kind: "acquired", reservationId: reservation.id };
      const latest = await task(command.ownerUserId, command.generationId);
      if (latest?.reservation_id === reservation.id) {
        return latest.state === "reserved"
          ? { kind: "acquired", reservationId: reservation.id }
          : { kind: "pending" };
      }
      await options.database.trusted((query) =>
        query.rows(
          `UPDATE quota_reservations SET status='released',updated_at=$4
            WHERE id=$1 AND owner_user_id=$2 AND request_id=$3 AND status='active'`,
          [reservation.id, command.ownerUserId, command.generationId, options.now()],
        ),
      );
      return { kind: "pending" };
    },
    async complete(command) {
      const output = practiceGenerationOutputSchema.parse(command.output);
      const calls = command.billedCalls.map((call) => ({
        cachedInputTokens: call.usage.cachedInputTokens,
        costMicroUsd: call.costMicroUsd,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
      }));
      await options.database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const updated = await tenant.rows<{ id: string }>(
          `UPDATE practice_generation_tasks SET state='ready',output=$4::jsonb,updated_at=now()
            WHERE id=$1 AND owner_user_id=$2 AND lease_token=$3 AND state='dispatched'
            RETURNING id::text`,
          [command.generationId, command.ownerUserId, command.leaseToken, JSON.stringify(output)],
        );
        if (updated[0] === undefined)
          throw new CloudFault("revision_conflict", "Practice generation changed.");
        await trusted.rows(
          `SELECT settle_practice_generation_quota(
            $1,$2,$3,$4::uuid[],$5::jsonb,'succeeded',$6
          )`,
          [
            command.ownerUserId,
            command.generationId,
            command.reservationId,
            calls.map(() => options.ledgerId()),
            JSON.stringify(calls),
            options.now(),
          ],
        );
      });
      return output;
    },
    async fail(command) {
      await options.database.transaction(command.ownerUserId, (queries) =>
        settleFailedPracticeGeneration(queries, {
          ...command,
          ledgerId: options.ledgerId,
          now: options.now(),
        }),
      );
    },
    async markDispatched(command) {
      const dispatchedAt = options.now();
      const pricing = options.pricing?.at(dispatchedAt);
      try {
        const rows = await options.database.transaction(
          command.ownerUserId,
          async ({ tenant, trusted }) => {
            if (pricing !== undefined) {
              await trusted.rows("SELECT require_model_price_version($1,'deepseek',$2,$3,$4,$5)", [
                pricing.priceVersionId,
                DEEPSEEK_PLATFORM_MODEL,
                pricing.prices.inputMicroUsdPerMillionTokens,
                pricing.prices.cachedInputMicroUsdPerMillionTokens,
                pricing.prices.outputMicroUsdPerMillionTokens,
              ]);
            }
            return tenant.rows<{ id: string }>(
              `UPDATE practice_generation_tasks SET state='dispatched',dispatched_at=$4,
                price_version_id=COALESCE($5,price_version_id),updated_at=$4
                WHERE id=$1 AND lease_token=$2 AND reservation_id=$3
                AND state='reserved' AND lease_expires_at>$4
                AND (price_version_id IS NOT NULL OR $5::uuid IS NOT NULL) RETURNING id::text`,
              [
                command.generationId,
                command.leaseToken,
                command.reservationId,
                dispatchedAt,
                pricing?.priceVersionId ?? null,
              ],
            );
          },
        );
        if (rows[0] === undefined) return false;
        return pricing === undefined ? true : { pricing };
      } catch (error) {
        if (error instanceof Error && error.message.includes("model price mismatch")) {
          throw new CloudFault("model_unavailable", "Model pricing is unavailable.");
        }
        throw error;
      }
    },
  };
}
