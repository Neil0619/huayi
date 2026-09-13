import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import {
  fixture,
  billedCalls,
  referenceResult,
  requestFor,
} from "./test-support/practice-reference-fixture.js";
import {
  practiceOwner,
  practiceOther,
  practiceVersions,
} from "./test-support/practice-teaching-fixture.js";
import { createPostgresPracticeReference } from "./postgres-practice-reference.js";

let f: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  f = await fixture();
});

it("invalidation definer stays inaccessible/owner-scoped and preserves dispatched billing after free mode", async () => {
  try {
    const metadata = (
      await f.db.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='huayi_private.invalidate_practice_reference()'::regprocedure",
      )
    ).rows;
    expect(metadata).toEqual([{ prosecdef: true, proconfig: ["search_path=pg_catalog"] }]);
    const roles = [
      "anon",
      "authenticated",
      "service_role",
      "huayi_business",
      "huayi_context_setter",
      "huayi_runtime",
    ];
    const privileges = (
      await f.db.query<{ rolname: string; executable: boolean }>(
        "SELECT rolname,has_function_privilege(oid,'huayi_private.invalidate_practice_reference()','EXECUTE') executable FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname",
        [roles],
      )
    ).rows;
    expect(privileges).toHaveLength(roles.length);
    expect(privileges.every((role) => !role.executable)).toBe(true);
    const session = await f.begin(),
      key = randomUUID(),
      request = requestFor(session);
    const repository = createPostgresPracticeReference(f.database);
    const claim = await repository.claim(practiceOwner, session.id, request, key);
    if (claim.state !== "claimed") throw new Error("Missing reference claim");
    const common = {
      ownerUserId: practiceOwner,
      kind: "sentence-reference" as const,
      generationId: claim.generationId,
      leaseToken: claim.leaseToken,
      input: claim.input,
    };
    const acquired = await f.generationRepository.acquire(common);
    if (acquired.kind !== "acquired") throw new Error("Missing real quota reservation");
    // The foreign account cannot reach the definer through an update to this owner's session.
    expect(
      await f.database.transaction(practiceOther, ({ tenant }) =>
        tenant.rows("UPDATE practice_sessions SET reference_state=NULL WHERE id=$1 RETURNING id", [
          session.id,
        ]),
      ),
    ).toEqual([]);
    expect(
      (
        await f.db.query("SELECT state FROM practice_generation_tasks WHERE id=$1", [
          claim.generationId,
        ])
      ).rows,
    ).toEqual([{ state: "reserved" }]);
    expect(
      (
        await f.db.query("SELECT status FROM quota_reservations WHERE id=$1", [
          acquired.reservationId,
        ])
      ).rows,
    ).toEqual([{ status: "active" }]);
    const dispatched = { ...common, reservationId: acquired.reservationId };
    expect(await f.generationRepository.markDispatched(dispatched)).toBe(true);
    await f.workspace.control(
      practiceOwner,
      session.id,
      { action: "free", ...practiceVersions(session) },
      randomUUID(),
    );
    expect(
      (
        await f.db.query("SELECT state FROM practice_generation_tasks WHERE id=$1", [
          claim.generationId,
        ])
      ).rows,
    ).toEqual([{ state: "dispatched" }]);
    expect(
      (
        await f.db.query("SELECT status FROM quota_reservations WHERE id=$1", [
          acquired.reservationId,
        ])
      ).rows,
    ).toEqual([{ status: "active" }]);
    // A delayed paid response uses real settlement, followed by real domain application.
    await f.generationRepository.complete({
      ...dispatched,
      billedCalls,
      output: { kind: "sentence-reference", ...referenceResult },
    });
    await repository.complete({
      ownerUserId: practiceOwner,
      sessionId: session.id,
      generationId: claim.generationId,
      generationLeaseToken: claim.leaseToken,
      idempotencyKey: key,
      requestHash: claim.requestHash,
      result: referenceResult,
    });
    expect((await f.charges()).ledger).toEqual([
      expect.objectContaining({
        cost_micro_usd: 10,
        outcome: "succeeded",
        feature: "practice.sentence-reference",
      }),
    ]);
    expect((await f.charges()).reservations).toEqual([
      expect.objectContaining({ status: "settled" }),
    ]);
    expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
      ready: false,
      reference: null,
    });
    expect(
      (
        await f.db.query("SELECT state,output FROM practice_generation_tasks WHERE id=$1", [
          claim.generationId,
        ])
      ).rows,
    ).toEqual([{ state: "applied", output: null }]);
  } finally {
    await f.db.close();
  }
});
