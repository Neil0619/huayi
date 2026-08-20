import { describe, expect, it } from "vitest";

import { quotaSummarySchema } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import { createQuotaModule } from "./quota-module.js";
import { MutableClock } from "./test-support/security-fakes.js";

describe("quota module", () => {
  it("returns the strict public warning projection", async () => {
    const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });

    await module.reserve({
      requestId: "request-1",
      reservedMicroUsd: 1_000,
      userId: "user-a",
    });
    expect(() => quotaSummarySchema.parse(module.summary("user-a"))).not.toThrow();
    expect(module.summary("user-a")).toMatchObject({
      percentUsed: 0,
      warning: "exhausted",
    });
  });
  it("serializes concurrent reservations and never overspends", async () => {
    const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
    module.grant({ limitMicroUsd: 100, source: "default", userId: "user-a" });

    const reservations = await Promise.allSettled([
      module.reserve({ requestId: "request-1", reservedMicroUsd: 60, userId: "user-a" }),
      module.reserve({ requestId: "request-2", reservedMicroUsd: 60, userId: "user-a" }),
    ]);

    expect(reservations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reservations.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(module.summary("user-a").reservedMicroUsd).toBe(60);
  });

  it("settles failures, conservatively charges missing usage, and appends immutable ledger", async () => {
    const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    const reservation = await module.reserve({
      requestId: "request-1",
      reservedMicroUsd: 300,
      userId: "user-a",
    });

    module.settle({
      feature: "analysis",
      outcome: "failed",
      priceVersionId: "price-1",
      reservationId: reservation.id,
    });

    expect(module.summary("user-a")).toMatchObject({
      reservedMicroUsd: 0,
      usedMicroUsd: 300,
    });
    expect(module.listLedger("user-a")).toEqual([
      expect.objectContaining({ costMicroUsd: 300, outcome: "failed" }),
    ]);
    expect(Object.isFrozen(module.listLedger("user-a")[0])).toBe(true);
  });

  it("returns the same active reservation for the same request without consuming rate or lease", async () => {
    const module = createQuotaModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      hourlyLimit: 1,
    });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    const first = await module.reserve({
      requestId: "request-1",
      reservedMicroUsd: 100,
      userId: "user-a",
    });

    await expect(
      module.reserve({ requestId: "request-1", reservedMicroUsd: 100, userId: "user-a" }),
    ).resolves.toEqual(first);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid reservation amount %s",
    async (reservedMicroUsd) => {
      const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
      module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
      await expect(
        module.reserve({ requestId: "request-1", reservedMicroUsd, userId: "user-a" }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    },
  );

  it("releases expired reservations before checking the active generation lease", async () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const module = createQuotaModule({ clock, reservationTtlMs: 1_000 });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    await module.reserve({ requestId: "request-1", reservedMicroUsd: 600, userId: "user-a" });
    clock.advance(1_001);

    await expect(
      module.reserve({ requestId: "request-2", reservedMicroUsd: 600, userId: "user-a" }),
    ).resolves.toMatchObject({ requestId: "request-2" });
  });

  it("never creates a second reservation for a finalized request ID", async () => {
    const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    const reservation = await module.reserve({
      requestId: "request-1",
      reservedMicroUsd: 100,
      userId: "user-a",
    });
    module.release(reservation.id);

    await expect(
      module.reserve({ requestId: "request-1", reservedMicroUsd: 100, userId: "user-a" }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid actual settlement cost %s",
    async (actualCostMicroUsd) => {
      const module = createQuotaModule({ clock: new MutableClock("2026-08-12T00:00:00.000Z") });
      module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
      const reservation = await module.reserve({
        requestId: "request-1",
        reservedMicroUsd: 100,
        userId: "user-a",
      });
      expect(() =>
        module.settle({
          actualCostMicroUsd,
          feature: "analysis",
          outcome: "failed",
          priceVersionId: "price-1",
          reservationId: reservation.id,
        }),
      ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    },
  );

  it("enforces generation leases, rate limits, UTC periods, and the model kill switch", async () => {
    const clock = new MutableClock("2026-08-31T23:59:00.000Z");
    const module = createQuotaModule({ clock, dailyLimit: 2, hourlyLimit: 1 });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    const reservation = await module.reserve({
      requestId: "request-1",
      reservedMicroUsd: 100,
      userId: "user-a",
    });
    await expect(
      module.reserve({ requestId: "request-2", reservedMicroUsd: 100, userId: "user-a" }),
    ).rejects.toMatchObject({ code: "generation_busy" });
    module.release(reservation.id);
    await expect(
      module.reserve({ requestId: "request-2", reservedMicroUsd: 100, userId: "user-a" }),
    ).rejects.toMatchObject({ code: "rate_limited" });

    clock.advance(60 * 60 * 1_000);
    module.grant({ limitMicroUsd: 2_000, source: "default", userId: "user-a" });
    expect(module.summary("user-a").periodStart).toBe("2026-09-01T00:00:00.000Z");
    module.setKillSwitch(true);
    await expect(
      module.reserve({ requestId: "request-3", reservedMicroUsd: 100, userId: "user-a" }),
    ).rejects.toBeInstanceOf(CloudFault);
  });

  it("settles a reservation against the UTC period in which it was created", async () => {
    const clock = new MutableClock("2026-08-31T23:59:59.000Z");
    const module = createQuotaModule({ clock, reservationTtlMs: 5_000 });
    module.grant({ limitMicroUsd: 1_000, source: "default", userId: "user-a" });
    const reservation = await module.reserve({
      requestId: "request-august",
      reservedMicroUsd: 100,
      userId: "user-a",
    });
    clock.advance(2_000);
    module.grant({ limitMicroUsd: 2_000, source: "default", userId: "user-a" });
    module.settle({
      feature: "analysis",
      outcome: "succeeded",
      priceVersionId: "price-1",
      reservationId: reservation.id,
    });

    expect(module.summary("user-a")).toMatchObject({ limitMicroUsd: 2_000, usedMicroUsd: 0 });
    expect(module.listLedger("user-a")[0]?.id).toMatch(/^2026-08-01T00:00:00\.000Z:/u);
  });
});
