import type { BackfillView } from "./backfill-messages.js";
import { BACKFILL_ERROR_CODES, type BackfillErrorCode } from "./backfill-errors.js";

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new TypeError("Invalid backfill response.");
  return value as Record<string, unknown>;
}

function boolean(value: unknown, defaultValue?: boolean): boolean {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "boolean") throw new TypeError("Invalid backfill response.");
  return value;
}

function integer(value: unknown, maximum = Infinity): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > maximum)
    throw new TypeError("Invalid backfill response.");
  return value;
}

function string(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum)
    throw new TypeError("Invalid backfill response.");
  return value;
}

// Match datetime({ offset: true }): calendar dates, optional seconds/fraction, and required zone.
// Keep this boundary in parity with the authoritative Worker schemas via differential tests.
function time(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const parts =
      /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u.exec(
        value,
      );
    if (parts) {
      const year = Number(parts[1]),
        month = Number(parts[2]),
        day = Number(parts[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
      if (days !== undefined && day >= 1 && day <= days) return value;
    }
  }
  throw new TypeError("Invalid backfill response.");
}

export function parseBackfillView(input: unknown): BackfillView {
  const value = record(input, [
    "initializing",
    "checking",
    "status",
    "shared",
    "needsLocalMerge",
    "localMergeBlocked",
    "reconnectRequired",
    "checkError",
    "incomplete",
    "lastCheckedAt",
  ]);
  const status = record(value.status, [
    "enabled",
    "dailyHour",
    "revision",
    "scopeId",
    "pendingCount",
    "unresolvedCount",
    "unknownCount",
    "lastCheckedAt",
  ]);
  return {
    initializing: boolean(value.initializing, false),
    checking: boolean(value.checking, false),
    status: {
      enabled: boolean(status.enabled),
      dailyHour: integer(status.dailyHour, 23),
      revision: integer(status.revision),
      scopeId: string(status.scopeId, 1, 200),
      pendingCount: integer(status.pendingCount),
      unresolvedCount: integer(status.unresolvedCount),
      unknownCount: integer(status.unknownCount),
      lastCheckedAt: time(status.lastCheckedAt),
    },
    shared: boolean(value.shared),
    needsLocalMerge: boolean(value.needsLocalMerge),
    localMergeBlocked: boolean(value.localMergeBlocked, false),
    reconnectRequired: boolean(value.reconnectRequired, false),
    checkError: value.checkError === null ? null : string(value.checkError, 0, 300),
    incomplete: boolean(value.incomplete),
    lastCheckedAt: time(value.lastCheckedAt),
  };
}

export function parseBackfillErrorCode(input: unknown): BackfillErrorCode {
  try {
    const value = record(input, ["code", "error"]);
    string(value.error, 0, 300);
    return BACKFILL_ERROR_CODES.find((code) => code === value.code) ?? "request-failed";
  } catch {
    return "request-failed";
  }
}
