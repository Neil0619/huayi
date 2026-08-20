import { duplicateSuggestionsResponseSchema, type ModelPrice } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { DuplicateSuggestionGenerationRepository } from "./paid-duplicate-suggestion-generator.js";

const beginResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("acquired"), reservationId: z.string().uuid() }),
  z.strictObject({ kind: z.literal("busy") }),
  z.strictObject({
    kind: z.literal("failed"),
    stableErrorCode: z.enum(["model_output_invalid", "model_unavailable"]),
  }),
  z.strictObject({ kind: z.literal("resolved"), response: duplicateSuggestionsResponseSchema }),
]);

function addMilliseconds(value: string, milliseconds: number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid duplicate suggestion time.");
  return new Date(date.getTime() + milliseconds);
}

function billedCalls(
  calls: Parameters<DuplicateSuggestionGenerationRepository["complete"]>[0]["billedCalls"],
) {
  return calls.map((call) => ({
    cachedInputTokens: call.usage.cachedInputTokens,
    costMicroUsd: call.costMicroUsd,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  }));
}

function mapError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("duplicate suggestion idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
  }
  if (message.includes("quota exhausted")) {
    throw new CloudFault("quota_exhausted", "The monthly model quota is exhausted.");
  }
  if (message.includes("model unavailable")) {
    throw new CloudFault("model_unavailable", "The model is temporarily unavailable.");
  }
  if (message.includes("model price mismatch")) {
    throw new CloudFault("model_unavailable", "Model pricing is unavailable.");
  }
  if (message.includes("duplicate suggestion lease lost")) {
    throw new CloudFault("generation_busy", "Duplicate suggestion generation lost its lease.");
  }
  if (
    message.includes("duplicate suggestion source conflict") ||
    message.includes("invalid duplicate suggestion candidates")
  ) {
    throw new CloudFault("revision_conflict", "The learning item changed.");
  }
  throw error;
}

export function createPostgresDuplicateSuggestionRepository(options: {
  database: AnalysisDatabase;
  ledgerId(): string;
  prices: ModelPrice;
  priceVersionId: string;
  providerModel: string;
  reservationId(): string;
}): DuplicateSuggestionGenerationRepository {
  return {
    async begin(command) {
      try {
        const result = await options.database.transaction(
          command.ownerUserId,
          async ({ trusted }) => {
            const rows = await trusted.rows<{ value: unknown }>(
              `SELECT begin_duplicate_suggestion_request(
              $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
            ) AS value`,
              [
                command.ownerUserId,
                command.requestId,
                options.reservationId(),
                options.priceVersionId,
                command.idempotencyKey,
                command.requestHash,
                command.sourceItemId,
                command.sourceRevision,
                JSON.stringify(command.candidateAliases),
                command.reservedMicroUsd,
                command.leaseToken,
                command.now,
                addMilliseconds(command.now, 2 * 60 * 1_000),
                addMilliseconds(command.now, 24 * 60 * 60 * 1_000),
                options.ledgerId(),
                "deepseek",
                options.providerModel,
                options.prices.inputMicroUsdPerMillionTokens,
                options.prices.cachedInputMicroUsdPerMillionTokens,
                options.prices.outputMicroUsdPerMillionTokens,
              ],
            );
            return beginResultSchema.parse(rows[0]?.value);
          },
        );
        if (result.kind === "failed") {
          throw new CloudFault(result.stableErrorCode, "Duplicate suggestion generation failed.");
        }
        return result;
      } catch (error) {
        if (error instanceof CloudFault) throw error;
        mapError(error);
      }
    },
    async complete(command) {
      const response = duplicateSuggestionsResponseSchema.parse(command.response);
      try {
        return await options.database.transaction(command.ownerUserId, async ({ trusted }) => {
          const rows = await trusted.rows<{ value: unknown }>(
            `SELECT finish_duplicate_suggestion_request(
              $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NULL,$8
            ) AS value`,
            [
              command.ownerUserId,
              command.requestId,
              command.leaseToken,
              command.reservationId,
              options.ledgerId(),
              JSON.stringify(billedCalls(command.billedCalls)),
              JSON.stringify(response),
              command.now,
            ],
          );
          return duplicateSuggestionsResponseSchema.parse(rows[0]?.value);
        });
      } catch (error) {
        mapError(error);
      }
    },
    async fail(command) {
      try {
        await options.database.transaction(command.ownerUserId, async ({ trusted }) => {
          await trusted.rows(
            `SELECT finish_duplicate_suggestion_request(
              $1,$2,$3,$4,$5,$6::jsonb,NULL,$7,$8
            )`,
            [
              command.ownerUserId,
              command.requestId,
              command.leaseToken,
              command.reservationId,
              options.ledgerId(),
              command.billedCalls === undefined
                ? null
                : JSON.stringify(billedCalls(command.billedCalls)),
              command.stableErrorCode,
              command.now,
            ],
          );
        });
      } catch (error) {
        mapError(error);
      }
    },
    async markDispatched(command) {
      try {
        const pricing = command.pricing ?? {
          priceVersionId: options.priceVersionId,
          prices: options.prices,
        };
        return await options.database.transaction(command.ownerUserId, async ({ trusted }) => {
          const rows = await trusted.rows<{ value: boolean }>(
            `SELECT mark_duplicate_suggestion_dispatched(
              $1,$2,$3,$4,$5,$6,'deepseek',$7,$8,$9,$10
            ) AS value`,
            [
              command.ownerUserId,
              command.requestId,
              command.leaseToken,
              command.reservationId,
              command.dispatchedAt ?? command.now,
              pricing.priceVersionId,
              options.providerModel,
              pricing.prices.inputMicroUsdPerMillionTokens,
              pricing.prices.cachedInputMicroUsdPerMillionTokens,
              pricing.prices.outputMicroUsdPerMillionTokens,
            ],
          );
          return rows[0]?.value === true;
        });
      } catch (error) {
        mapError(error);
      }
    },
  };
}
