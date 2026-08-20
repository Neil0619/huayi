import type { QuotaSummary } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { Clock } from "./security.js";

interface Grant {
  limitMicroUsd: number;
  periodEnd: Date;
  periodStart: Date;
  source: string;
}
interface Reservation {
  expiresAt: Date;
  id: string;
  periodStart: Date;
  requestId: string;
  reservedMicroUsd: number;
  status: "active" | "settled" | "released";
  userId: string;
}
type LedgerEntry = Readonly<{
  costMicroUsd: number;
  feature: string;
  id: string;
  outcome: "succeeded" | "failed";
  priceVersionId: string;
  requestId: string;
  userId: string;
}>;

export interface QuotaModuleOptions {
  clock: Clock;
  dailyLimit?: number;
  hourlyLimit?: number;
  reservationTtlMs?: number;
}

function utcPeriod(date: Date): { periodEnd: Date; periodStart: Date } {
  const periodStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { periodEnd, periodStart };
}

export function createQuotaModule(options: QuotaModuleOptions) {
  const grants = new Map<string, Grant>();
  const reservations = new Map<string, Reservation>();
  const ledger: LedgerEntry[] = [];
  const locks = new Map<string, Promise<void>>();
  const generationLeases = new Set<string>();
  const rateEvents = new Map<string, number[]>();
  let sequence = 0;
  let killSwitch = false;

  async function locked<T>(userId: string, operation: () => T): Promise<T> {
    const previous = locks.get(userId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    locks.set(userId, queued);
    await previous;
    try {
      return operation();
    } finally {
      release();
      if (locks.get(userId) === queued) locks.delete(userId);
    }
  }

  function grant(command: {
    limitMicroUsd: number;
    periodStart?: Date;
    source: string;
    userId: string;
  }): Grant {
    if (!Number.isSafeInteger(command.limitMicroUsd) || command.limitMicroUsd < 0) {
      throw new CloudFault("invalid_request", "The quota limit is invalid.");
    }
    const period = utcPeriod(command.periodStart ?? options.clock.now());
    const value = { ...period, limitMicroUsd: command.limitMicroUsd, source: command.source };
    grants.set(`${command.userId}:${period.periodStart.toISOString()}`, value);
    return value;
  }

  function currentGrant(userId: string): Grant {
    const period = utcPeriod(options.clock.now());
    const value = grants.get(`${userId}:${period.periodStart.toISOString()}`);
    if (value === undefined) throw new CloudFault("quota_exhausted", "No quota grant is active.");
    return value;
  }

  function values(userId: string) {
    const quota = currentGrant(userId);
    const usedMicroUsd = ledger
      .filter(
        (entry) =>
          entry.userId === userId && entry.id.startsWith(`${quota.periodStart.toISOString()}:`),
      )
      .reduce((sum, entry) => sum + entry.costMicroUsd, 0);
    const reservedMicroUsd = [...reservations.values()]
      .filter((reservation) => reservation.userId === userId && reservation.status === "active")
      .reduce((sum, reservation) => sum + reservation.reservedMicroUsd, 0);
    return { quota, reservedMicroUsd, usedMicroUsd };
  }

  function enforceRate(userId: string): void {
    const now = options.clock.now().getTime();
    const recent = (rateEvents.get(userId) ?? []).filter(
      (time) => time > now - 24 * 60 * 60 * 1_000,
    );
    const hourly = recent.filter((time) => time > now - 60 * 60 * 1_000);
    if (
      hourly.length >= (options.hourlyLimit ?? 60) ||
      recent.length >= (options.dailyLimit ?? 300)
    ) {
      throw new CloudFault("rate_limited", "The model request rate limit was reached.");
    }
    recent.push(now);
    rateEvents.set(userId, recent);
  }

  async function reserve(command: { requestId: string; reservedMicroUsd: number; userId: string }) {
    return locked(command.userId, () => {
      if (!Number.isSafeInteger(command.reservedMicroUsd) || command.reservedMicroUsd <= 0) {
        throw new CloudFault("invalid_request", "The reservation amount is invalid.");
      }
      const existing = [...reservations.values()].find(
        (reservation) => reservation.requestId === command.requestId,
      );
      if (existing !== undefined) {
        if (
          existing.userId !== command.userId ||
          existing.reservedMicroUsd !== command.reservedMicroUsd
        ) {
          throw new CloudFault("idempotency_conflict", "The request ID was reused.");
        }
        if (existing.status === "active" && existing.expiresAt > options.clock.now()) {
          return { ...existing };
        }
        throw new CloudFault("idempotency_conflict", "The request ID is already finalized.");
      }
      for (const reservation of reservations.values()) {
        if (reservation.status === "active" && reservation.expiresAt <= options.clock.now()) {
          reservation.status = "released";
          generationLeases.delete(reservation.userId);
        }
      }
      if (killSwitch) throw new CloudFault("model_unavailable", "Model generation is disabled.");
      if (generationLeases.has(command.userId)) {
        throw new CloudFault("generation_busy", "Another generation is active.");
      }
      enforceRate(command.userId);
      const { quota, reservedMicroUsd, usedMicroUsd } = values(command.userId);
      if (usedMicroUsd + reservedMicroUsd + command.reservedMicroUsd > quota.limitMicroUsd) {
        throw new CloudFault("quota_exhausted", "The usage allowance is exhausted.");
      }
      sequence += 1;
      const reservation: Reservation = {
        expiresAt: new Date(
          options.clock.now().getTime() + (options.reservationTtlMs ?? 2 * 60 * 1_000),
        ),
        id: `reservation-${sequence}`,
        periodStart: quota.periodStart,
        requestId: command.requestId,
        reservedMicroUsd: command.reservedMicroUsd,
        status: "active",
        userId: command.userId,
      };
      reservations.set(reservation.id, reservation);
      generationLeases.add(command.userId);
      return { ...reservation };
    });
  }

  function requireActiveReservation(id: string): Reservation {
    const reservation = reservations.get(id);
    if (reservation === undefined || reservation.status !== "active") {
      throw new CloudFault("not_found", "The quota reservation is unavailable.");
    }
    return reservation;
  }

  function settle(command: {
    actualCostMicroUsd?: number;
    feature: string;
    outcome: "succeeded" | "failed";
    priceVersionId: string;
    reservationId: string;
  }): LedgerEntry {
    const reservation = requireActiveReservation(command.reservationId);
    const costMicroUsd = command.actualCostMicroUsd ?? reservation.reservedMicroUsd;
    if (
      !Number.isSafeInteger(costMicroUsd) ||
      costMicroUsd > reservation.reservedMicroUsd ||
      costMicroUsd < 0
    ) {
      throw new CloudFault("invalid_request", "The settlement cost is invalid.");
    }
    reservation.status = "settled";
    generationLeases.delete(reservation.userId);
    const entry = Object.freeze({
      costMicroUsd,
      feature: command.feature,
      id: `${reservation.periodStart.toISOString()}:ledger-${ledger.length + 1}`,
      outcome: command.outcome,
      priceVersionId: command.priceVersionId,
      requestId: reservation.requestId,
      userId: reservation.userId,
    });
    ledger.push(entry);
    return entry;
  }

  function release(reservationId: string): void {
    const reservation = requireActiveReservation(reservationId);
    reservation.status = "released";
    generationLeases.delete(reservation.userId);
  }

  function summary(userId: string): QuotaSummary {
    const { quota, reservedMicroUsd, usedMicroUsd } = values(userId);
    const committed = reservedMicroUsd + usedMicroUsd;
    const percentUsed =
      quota.limitMicroUsd === 0 ? 100 : Math.min(100, (usedMicroUsd / quota.limitMicroUsd) * 100);
    return {
      availableMicroUsd: Math.max(0, quota.limitMicroUsd - committed),
      limitMicroUsd: quota.limitMicroUsd,
      percentUsed,
      periodEnd: quota.periodEnd.toISOString(),
      periodStart: quota.periodStart.toISOString(),
      reservedMicroUsd,
      usedMicroUsd,
      warning:
        committed >= quota.limitMicroUsd
          ? "exhausted"
          : percentUsed >= 80
            ? "warning"
            : "available",
    };
  }

  return {
    grant,
    listLedger: (userId: string) => ledger.filter((entry) => entry.userId === userId),
    release,
    reserve,
    setKillSwitch: (enabled: boolean) => {
      killSwitch = enabled;
    },
    settle,
    summary,
  };
}

export type QuotaModule = ReturnType<typeof createQuotaModule>;
