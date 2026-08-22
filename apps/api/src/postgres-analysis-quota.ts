import type { ModelPrice } from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import type { AnalysisQuota } from "./analysis-ports.js";
import { CloudFault } from "./cloud-fault.js";

export function createPostgresAnalysisQuota(options: {
  database: AnalysisDatabase;
  expiresAt: () => Date;
  id: () => string;
  now: () => Date;
  priceVersionId: string;
  prices?: ModelPrice;
  providerModel?: string;
}): AnalysisQuota {
  return {
    async reserve(command) {
      try {
        const id = options.id();
        const priceVersionId = command.pricing?.priceVersionId ?? options.priceVersionId;
        const prices = command.pricing?.prices ?? options.prices;
        const rows = await options.database.trusted(async (query) => {
          if (prices !== undefined && options.providerModel !== undefined) {
            await query.rows("SELECT require_model_price_version($1,'deepseek',$2,$3,$4,$5)", [
              priceVersionId,
              options.providerModel,
              prices.inputMicroUsdPerMillionTokens,
              prices.cachedInputMicroUsdPerMillionTokens,
              prices.outputMicroUsdPerMillionTokens,
            ]);
          }
          return query.rows<{ id: string }>("SELECT reserve_quota($1,$2,$3,$4,$5)::text AS id", [
            id,
            command.userId,
            command.requestId,
            command.reservedMicroUsd,
            options.expiresAt(),
          ]);
        });
        return { id: rows[0]?.id ?? id };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("quota exhausted"))
          throw new CloudFault("quota_exhausted", "Quota exhausted.");
        if (message.includes("model rate limited"))
          throw new CloudFault("rate_limited", "The model request rate limit was reached.");
        if (message.includes("model unavailable"))
          throw new CloudFault("model_unavailable", "Model unavailable.");
        if (message.includes("model price mismatch"))
          throw new CloudFault("model_unavailable", "Model pricing is unavailable.");
        throw error;
      }
    },
    async settle(command) {
      const calls = settlementCalls(command, command.actualCostMicroUsd ?? 100_000);
      await options.database.trusted((query) =>
        query.rows("SELECT settle_quota_reservation($1,$2::uuid[],'analysis',$3,$4::jsonb,$5)", [
          command.reservationId,
          calls.map(() => options.id()),
          options.priceVersionId,
          JSON.stringify(calls),
          command.outcome,
        ]),
      );
    },
    async summary(userId) {
      const now = options.now();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const rows = await options.database.transaction(userId, async ({ tenant, trusted }) => {
        await trusted.rows("SELECT ensure_owner_current_default_quota($1,$2)", [userId, now]);
        return tenant.rows<{
          limit_micro_usd: string;
          period_end: Date;
          period_start: Date;
          reserved_micro_usd: string;
          used_micro_usd: string;
        }>(
          `SELECT grants.limit_micro_usd::text, grants.period_start, grants.period_end,
        COALESCE((SELECT sum(cost_micro_usd) FROM usage_ledger WHERE user_id=$1
          AND period_start=grants.period_start),0)::text AS used_micro_usd,
        COALESCE((SELECT sum(reserved_micro_usd) FROM quota_reservations WHERE user_id=$1
          AND period_start=grants.period_start AND status='active'),0)::text AS reserved_micro_usd
        FROM quota_grants grants WHERE grants.user_id=$1 AND grants.period_start=$2
          AND grants.superseded_at IS NULL
        LIMIT 1`,
          [userId, periodStart],
        );
      });
      const row = rows[0];
      if (row === undefined) {
        const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
        return {
          availableMicroUsd: 0,
          limitMicroUsd: 0,
          percentUsed: 100,
          periodEnd: periodEnd.toISOString(),
          periodStart: periodStart.toISOString(),
          reservedMicroUsd: 0,
          usedMicroUsd: 0,
          warning: "exhausted",
        };
      }
      const limitMicroUsd = Number(row.limit_micro_usd);
      const usedMicroUsd = Number(row.used_micro_usd);
      const reservedMicroUsd = Number(row.reserved_micro_usd);
      const committed = usedMicroUsd + reservedMicroUsd;
      const percentUsed =
        limitMicroUsd === 0 ? 100 : Math.min(100, (usedMicroUsd / limitMicroUsd) * 100);
      return {
        availableMicroUsd: Math.max(0, limitMicroUsd - committed),
        limitMicroUsd,
        percentUsed,
        periodEnd: row.period_end.toISOString(),
        periodStart: row.period_start.toISOString(),
        reservedMicroUsd,
        usedMicroUsd,
        warning:
          committed >= limitMicroUsd ? "exhausted" : percentUsed >= 80 ? "warning" : "available",
      };
    },
  };
}

function settlementCalls(
  command: Parameters<AnalysisQuota["settle"]>[0],
  fallbackCostMicroUsd: number,
) {
  if (command.billedCalls !== undefined) {
    return command.billedCalls.map((call) => ({
      cachedInputTokens: call.usage.cachedInputTokens,
      costMicroUsd: call.costMicroUsd,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
    }));
  }
  return [
    {
      cachedInputTokens: command.usage?.cachedInputTokens ?? null,
      costMicroUsd: fallbackCostMicroUsd,
      inputTokens: command.usage?.inputTokens ?? null,
      outputTokens: command.usage?.outputTokens ?? null,
    },
  ];
}
