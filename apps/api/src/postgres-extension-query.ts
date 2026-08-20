import {
  extensionQueryEventSchema,
  extensionQueryGenerationSchema,
  extensionQueryRequestSchema,
  quotaSummarySchema,
  type ExtensionQueryEvent,
  type QuotaSummary,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ExtensionQueryStore } from "./extension-query-ports.js";

interface Row {
  created_at: Date;
  expires_at: Date;
  id: string;
  lease_expires_at: Date;
  request_hash: string;
  reservation_id: string | null;
  state: "running" | "completed" | "failed";
  terminal_event: unknown;
}

function mapError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
  }
  if (message.includes("query lease lost")) {
    throw new CloudFault("idempotency_conflict", "The query lease is no longer active.");
  }
  throw error;
}

async function quotaSummary(query: AnalysisQuery, userId: string): Promise<QuotaSummary> {
  const rows = await query.rows<{
    limit_micro_usd: string;
    period_end: Date;
    period_start: Date;
    reserved_micro_usd: string;
    used_micro_usd: string;
  }>(
    `SELECT grants.limit_micro_usd::text,grants.period_start,grants.period_end,
    COALESCE((SELECT sum(cost_micro_usd) FROM usage_ledger WHERE user_id=$1
      AND period_start=grants.period_start),0)::text AS used_micro_usd,
    COALESCE((SELECT sum(reserved_micro_usd) FROM quota_reservations WHERE user_id=$1
      AND period_start=grants.period_start AND status='active'),0)::text AS reserved_micro_usd
    FROM quota_grants grants WHERE grants.user_id=$1 AND grants.superseded_at IS NULL
    ORDER BY period_start DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Missing quota grant.");
  const limitMicroUsd = Number(row.limit_micro_usd);
  const usedMicroUsd = Number(row.used_micro_usd);
  const reservedMicroUsd = Number(row.reserved_micro_usd);
  const committed = usedMicroUsd + reservedMicroUsd;
  const percentUsed =
    limitMicroUsd === 0 ? 100 : Math.min(100, (usedMicroUsd / limitMicroUsd) * 100);
  return quotaSummarySchema.parse({
    availableMicroUsd: Math.max(0, limitMicroUsd - committed),
    limitMicroUsd,
    percentUsed,
    periodEnd: row.period_end.toISOString(),
    periodStart: row.period_start.toISOString(),
    reservedMicroUsd,
    usedMicroUsd,
    warning: committed >= limitMicroUsd ? "exhausted" : percentUsed >= 80 ? "warning" : "available",
  });
}

function settlement(command: Parameters<ExtensionQueryStore["complete"]>[0]) {
  return (
    command.billedCalls?.map((call) => ({
      cachedInputTokens: call.usage.cachedInputTokens,
      costMicroUsd: call.costMicroUsd,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
    })) ?? [
      {
        cachedInputTokens: command.usage.cachedInputTokens,
        costMicroUsd: command.costMicroUsd,
        inputTokens: command.usage.inputTokens,
        outputTokens: command.usage.outputTokens,
      },
    ]
  );
}

export function createPostgresExtensionQueryStore(options: {
  database: AnalysisDatabase;
  ledgerId: () => string;
  now: () => Date;
  priceVersionId: string;
}): ExtensionQueryStore {
  const terminal = async (
    command:
      Parameters<ExtensionQueryStore["complete"]>[0] | Parameters<ExtensionQueryStore["fail"]>[0],
    outcome: "succeeded" | "failed",
  ): Promise<ExtensionQueryEvent> =>
    options.database.transaction(command.userId, async ({ tenant, trusted }) => {
      const rows = await tenant.rows<Row>(
        `SELECT id::text,state,request_hash,reservation_id::text,terminal_event,created_at,
        expires_at,lease_expires_at FROM extension_query_generations WHERE id=$1 FOR UPDATE`,
        [command.id],
      );
      const row = rows[0];
      if (row === undefined || row.state !== "running" || row.lease_expires_at <= options.now()) {
        throw new Error("query lease lost");
      }
      const calls =
        "result" in command
          ? settlement(command)
          : (command.billedCalls?.map((call) => ({
              cachedInputTokens: call.usage.cachedInputTokens,
              costMicroUsd: call.costMicroUsd,
              inputTokens: call.usage.inputTokens,
              outputTokens: call.usage.outputTokens,
            })) ?? [
              {
                cachedInputTokens: command.usage?.cachedInputTokens ?? 0,
                costMicroUsd: command.costMicroUsd ?? 0,
                inputTokens: command.usage?.inputTokens ?? 0,
                outputTokens: command.usage?.outputTokens ?? 0,
              },
            ]);
      await trusted.rows(
        `SELECT settle_quota_reservation($1,$2::uuid[],'extension-query',$3,$4::jsonb,$5)`,
        [
          command.reservationId,
          calls.map(() => options.ledgerId()),
          command.priceVersionId ?? options.priceVersionId,
          JSON.stringify(calls),
          outcome,
        ],
      );
      const quota = await quotaSummary(tenant, command.userId);
      const event = extensionQueryEventSchema.parse(
        "result" in command
          ? { generationId: command.id, quota, result: command.result, type: "query.completed" }
          : { error: command.error, generationId: command.id, quota, type: "query.failed" },
      );
      await tenant.rows(
        `UPDATE extension_query_generations SET state=$2,terminal_event=$3::jsonb,updated_at=$4
         WHERE id=$1 AND state='running' AND lease_token=$5`,
        [
          command.id,
          "result" in command ? "completed" : "failed",
          JSON.stringify(event),
          options.now(),
          command.leaseToken,
        ],
      );
      return event;
    });

  return {
    async abandon(userId, id) {
      const rows = await options.database.trusted((query) =>
        query.rows<{ value: unknown }>("SELECT abandon_extension_query($1,$2,$3) AS value", [
          userId,
          id,
          options.ledgerId(),
        ]),
      );
      const event = extensionQueryEventSchema.parse(rows[0]?.value);
      if (event.type !== "query.failed") throw new Error("Invalid abandoned query event.");
      return event;
    },
    async attachReservation(command) {
      const updated = await options.database.transaction(command.userId, ({ tenant }) =>
        tenant.rows<{ id: string }>(
          `UPDATE extension_query_generations SET reservation_id=$4,price_version_id=$5,updated_at=$6
           WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>$3 RETURNING id::text`,
          [
            command.id,
            command.leaseToken,
            options.now(),
            command.reservationId,
            command.priceVersionId ?? null,
            options.now(),
          ],
        ),
      );
      if (updated.length !== 1) throw new Error("query lease lost");
    },
    async begin(command) {
      try {
        return await options.database.transaction(command.userId, async ({ tenant }) => {
          await tenant.rows(
            `DELETE FROM extension_query_generations
             WHERE state IN ('completed','failed') AND expires_at<=$1`,
            [options.now()],
          );
          const rows = await tenant.rows<Row>(
            `SELECT id::text,state,request_hash,reservation_id::text,terminal_event,created_at,
             expires_at,lease_expires_at FROM extension_query_generations
             WHERE idempotency_key=$1 FOR UPDATE`,
            [command.idempotencyKey],
          );
          const existing = rows[0];
          if (existing !== undefined) {
            if (existing.request_hash !== command.requestHash)
              throw new Error("idempotency conflict");
            if (existing.state !== "running")
              return {
                event: extensionQueryEventSchema.parse(existing.terminal_event),
                id: existing.id,
                kind: "terminal" as const,
              };
            return {
              id: existing.id,
              kind:
                existing.lease_expires_at <= options.now()
                  ? ("expired" as const)
                  : ("running" as const),
            };
          }
          await tenant.rows(
            `INSERT INTO extension_query_generations(id,owner_user_id,idempotency_key,request_hash,
             state,request,lease_token,lease_expires_at,expires_at,created_at,updated_at)
             VALUES($1,$2,$3,$4,'running',$5::jsonb,$6,$7,$8,$9,$9)`,
            [
              command.id,
              command.userId,
              command.idempotencyKey,
              command.requestHash,
              JSON.stringify(extensionQueryRequestSchema.parse(command.input)),
              command.leaseToken,
              command.leaseExpiresAt,
              command.expiresAt,
              options.now(),
            ],
          );
          return { id: command.id, kind: "acquired" as const, leaseToken: command.leaseToken };
        });
      } catch (error) {
        mapError(error);
      }
    },
    async complete(command) {
      const event = await terminal(command, "succeeded");
      if (event.type !== "query.completed") throw new Error("Invalid completion.");
      return event;
    },
    async fail(command) {
      const event = await terminal(command, "failed");
      if (event.type !== "query.failed") throw new Error("Invalid failure.");
      return event;
    },
    async find(userId, id) {
      return options.database.transaction(userId, async ({ tenant }) => {
        await tenant.rows(
          `DELETE FROM extension_query_generations
           WHERE state IN ('completed','failed') AND expires_at<=$1`,
          [options.now()],
        );
        const rows = await tenant.rows<Row>(
          `SELECT id::text,state,request_hash,reservation_id::text,terminal_event,created_at,
           expires_at,lease_expires_at FROM extension_query_generations WHERE id=$1`,
          [id],
        );
        const row = rows[0];
        if (row === undefined) return null;
        const common = {
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          id: row.id,
          state: row.state,
        };
        if (row.state === "running") return extensionQueryGenerationSchema.parse(common);
        const event = extensionQueryEventSchema.parse(row.terminal_event);
        if (event.type === "query.completed") {
          return extensionQueryGenerationSchema.parse({ ...common, result: event.result });
        }
        if (event.type !== "query.failed") throw new Error("Invalid terminal query event.");
        return extensionQueryGenerationSchema.parse({ ...common, error: event.error });
      });
    },
    async markDispatched(command) {
      try {
        const operationTime = command.dispatchedAt ?? options.now();
        const rows = await options.database.transaction(
          command.userId,
          async ({ tenant, trusted }) => {
            if (command.pricing !== undefined) {
              await trusted.rows("SELECT require_model_price_version($1,'deepseek',$2,$3,$4,$5)", [
                command.pricing.priceVersionId,
                "deepseek-v4-flash",
                command.pricing.prices.inputMicroUsdPerMillionTokens,
                command.pricing.prices.cachedInputMicroUsdPerMillionTokens,
                command.pricing.prices.outputMicroUsdPerMillionTokens,
              ]);
            }
            return tenant.rows(
              `UPDATE extension_query_generations SET dispatched_at=$3,updated_at=$3,
                price_version_id=COALESCE($4,price_version_id)
               WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>$3
                 AND reservation_id IS NOT NULL
                 AND (price_version_id IS NOT NULL OR $4::uuid IS NOT NULL)
                 AND dispatched_at IS NULL RETURNING id`,
              [
                command.id,
                command.leaseToken,
                operationTime,
                command.pricing?.priceVersionId ?? null,
              ],
            );
          },
        );
        if (rows.length !== 1) throw new Error("query lease lost");
      } catch (error) {
        if (error instanceof Error && error.message.includes("model price mismatch")) {
          throw new CloudFault("model_unavailable", "Model pricing is unavailable.");
        }
        mapError(error);
      }
    },
    async terminalizeWithoutReservation(command) {
      const event = extensionQueryEventSchema.parse({
        error: command.error,
        generationId: command.id,
        quota: command.quota,
        type: "query.failed",
      });
      const rows = await options.database.transaction(command.userId, ({ tenant }) =>
        tenant.rows(
          `UPDATE extension_query_generations SET state='failed',terminal_event=$4::jsonb,updated_at=$5
         WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_expires_at>$3 RETURNING id`,
          [command.id, command.leaseToken, options.now(), JSON.stringify(event), options.now()],
        ),
      );
      if (rows.length !== 1) throw new Error("query lease lost");
    },
  };
}
