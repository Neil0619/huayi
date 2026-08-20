import {
  adminUsageSummarySchema,
  type AdminUsageSummary,
  type QuotaSummary,
} from "@huayi/cloud-contracts";

import type { AdminAuthorization, AdminRepositoryCommand } from "./admin-operations-module.js";
import { CloudFault } from "./cloud-fault.js";

const MAX_REAUTHENTICATION_AGE_MS = 15 * 60 * 1_000;

export interface UserRow {
  created_at: Date | string;
  device_count: number | string;
  email: string;
  id: string;
  limit_micro_usd: number | string;
  reserved_micro_usd: number | string;
  status: "active" | "deleting" | "disabled";
  used_micro_usd: number | string;
}

export interface UsageRow {
  active_accounts: number | string;
  deleting_accounts: number | string;
  disabled_accounts: number | string;
  failed_calls: number | string;
  failed_requests: number | string;
  kill_switch_enabled: boolean;
  kill_switch_updated_at: Date | string;
  limit_micro_usd: number | string;
  p95_latency_ms: number | string;
  repaired_requests: number | string;
  reserved_micro_usd: number | string;
  succeeded_calls: number | string;
  succeeded_requests: number | string;
  used_micro_usd: number | string;
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function integer(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CloudFault("invalid_request", "Administrator data is invalid.");
  }
  return parsed;
}

export function currentUtcPeriod(now: Date) {
  return {
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

export function quota(
  row: {
    limit_micro_usd: number | string;
    reserved_micro_usd: number | string;
    used_micro_usd: number | string;
  },
  range: { end: Date; start: Date },
): QuotaSummary {
  const limitMicroUsd = integer(row.limit_micro_usd);
  const reservedMicroUsd = integer(row.reserved_micro_usd);
  const usedMicroUsd = integer(row.used_micro_usd);
  const committed = usedMicroUsd + reservedMicroUsd;
  const percentUsed =
    limitMicroUsd === 0 ? 100 : Math.min(100, (usedMicroUsd / limitMicroUsd) * 100);
  return {
    availableMicroUsd: Math.max(0, limitMicroUsd - committed),
    limitMicroUsd,
    percentUsed,
    periodEnd: range.end.toISOString(),
    periodStart: range.start.toISOString(),
    reservedMicroUsd,
    usedMicroUsd,
    warning: committed >= limitMicroUsd ? "exhausted" : percentUsed >= 80 ? "warning" : "available",
  };
}

export function requireRecent(authorization: AdminAuthorization, now: Date): void {
  const age = now.getTime() - authorization.reauthenticatedAt.getTime();
  if (age < 0 || age > MAX_REAUTHENTICATION_AGE_MS) {
    throw new CloudFault("forbidden", "Recent operator authentication is required.");
  }
}

export function translateAdminError(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  if (message.includes("revision conflict")) {
    throw new CloudFault("revision_conflict", "The account state changed.");
  }
  if (message.includes("not found")) {
    throw new CloudFault("not_found", "The administrator resource was not found.");
  }
  if (message.includes("invalid quota period")) {
    throw new CloudFault("invalid_request", "The quota period is invalid.");
  }
  if (message.includes("administrator required") || message.includes("self status change")) {
    throw new CloudFault("forbidden", "Operator permission is required.");
  }
  throw error;
}

export function page<T extends { createdAt: string; id: string }>(items: T[], limit: number) {
  const visible = items.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible,
    next:
      items.length > limit && last !== undefined
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}

export function payloadFor(
  command: AdminRepositoryCommand,
): Record<string, boolean | number | string> {
  if (command.type === "create-invitation") return { expiresInHours: command.expiresInHours };
  if (command.type === "set-user-status") return { action: command.action };
  if (command.type === "set-user-quota") {
    return { limitMicroUsd: command.limitMicroUsd, periodStart: command.periodStart };
  }
  if (command.type === "set-kill-switch") return { enabled: command.enabled };
  return {};
}

export function usageSummary(
  row: UsageRow | undefined,
  range: { end: Date; start: Date },
): AdminUsageSummary {
  if (row === undefined)
    throw new CloudFault("invalid_request", "Administrator usage is unavailable.");
  const active = integer(row.active_accounts);
  const deleting = integer(row.deleting_accounts);
  const disabled = integer(row.disabled_accounts);
  const succeeded = integer(row.succeeded_requests);
  const failed = integer(row.failed_requests);
  const repaired = integer(row.repaired_requests);
  const terminal = succeeded + failed;
  const limitMicroUsd = integer(row.limit_micro_usd);
  const usedMicroUsd = integer(row.used_micro_usd);
  const reservedMicroUsd = integer(row.reserved_micro_usd);
  return adminUsageSummarySchema.parse({
    accounts: { active, deleting, disabled, total: active + deleting + disabled },
    analysisRequests: {
      failed,
      p95LatencyMs: integer(row.p95_latency_ms),
      repaired,
      repairRatePercent: terminal === 0 ? 0 : (repaired / terminal) * 100,
      succeeded,
      successRatePercent: terminal === 0 ? 0 : (succeeded / terminal) * 100,
      terminal,
    },
    killSwitch: { enabled: row.kill_switch_enabled, updatedAt: iso(row.kill_switch_updated_at) },
    periodEnd: range.end.toISOString(),
    periodStart: range.start.toISOString(),
    quota: {
      availableMicroUsd: Math.max(0, limitMicroUsd - usedMicroUsd - reservedMicroUsd),
      limitMicroUsd,
      reservedMicroUsd,
      usedMicroUsd,
    },
    usageCalls: { failed: integer(row.failed_calls), succeeded: integer(row.succeeded_calls) },
  });
}
