import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { createPostgresPracticeGenerationRepository } from "./postgres-practice-generation.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";
const itemId = "60000000-0000-0000-0000-00000000000a";
const sessionId = "90000000-0000-0000-0000-00000000000a";
const priceId = "92000000-0000-0000-0000-000000000001";

describe("Postgres practice generation recovery", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let generatedId = 0;
  const nextId = () => {
    generatedId += 1;
    return `94000000-0000-0000-0000-${String(generatedId).padStart(12, "0")}`;
  };
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = createPgliteAnalysisDatabase(database);
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userId}','${userId}','a@example.test','active','UTC',2);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${itemId}','${userId}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${itemId}','${userId}',-1,NULL);
      INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt)
      VALUES('${sessionId}','${userId}','sentence-creation','active','Prompt.');
      INSERT INTO model_price_versions(id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from)
      VALUES('${priceId}','deepseek','practice-fixed',100,100,100,now());`);
  });
  afterEach(async () => database.close());

  it("conservatively settles expired/released dispatch and clears every domain lease", async () => {
    const generationId = "95000000-0000-0000-0000-000000000001";
    const reservationId = "96000000-0000-0000-0000-000000000001";
    const attemptId = "98000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,
      period_start,reserved_micro_usd,status,expires_at)
      VALUES('${reservationId}','${userId}','${userId}','${generationId}',date_trunc('month',now()),
        100,'released',now()-interval '1 second');
      INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,submitted_at,
        feedback_lease_token,feedback_lease_expires_at)
      VALUES('${attemptId}','${sessionId}','${userId}','Answer.',now(),'expired',now()-interval '1 second');
      INSERT INTO practice_generation_tasks(id,owner_user_id,session_id,attempt_id,kind,state,
        request_hash,lease_token,lease_expires_at,reservation_id,price_version_id,
        reserved_micro_usd,dispatched_at)
      VALUES('${generationId}','${userId}','${sessionId}','${attemptId}','sentence-feedback',
        'dispatched','${"a".repeat(64)}','expired',now()-interval '1 second','${reservationId}',
        '${priceId}',100,now()-interval '2 minutes');
      UPDATE practice_attempts SET current_generation_id='${generationId}' WHERE id='${attemptId}';`);
    const generation = createPostgresPracticeGenerationRepository({
      database: adapter,
      ledgerId: nextId,
      now: () => new Date(),
      priceVersionId: priceId,
      quota: {
        reserve: async () => ({ id: "unused" }),
        settle: async () => undefined,
        summary: async () => {
          throw new Error("unused");
        },
      },
      reservedMicroUsd: 100,
    });
    await expect(
      generation.acquire({
        generationId,
        input: { itemContent: "to be frank" },
        kind: "sentence-feedback",
        leaseToken: "expired",
        ownerUserId: userId,
      }),
    ).resolves.toEqual({ kind: "pending" });
    const rows = await database.query<{
      attempt_generation: string | null;
      state: string;
      status: string;
    }>(
      `SELECT attempts.current_generation_id::text attempt_generation,tasks.state,reservations.status
        FROM practice_generation_tasks tasks JOIN practice_attempts attempts ON attempts.id=tasks.attempt_id
        JOIN quota_reservations reservations ON reservations.id=tasks.reservation_id WHERE tasks.id=$1`,
      [generationId],
    );
    expect(rows.rows[0]).toEqual({
      attempt_generation: null,
      state: "abandoned",
      status: "settled",
    });
  });

  it("clears a claimed task when quota fails before dispatch", async () => {
    await database.query("DELETE FROM practice_sessions WHERE id=$1", [sessionId]);
    const repository = createPostgresPracticeRepository(adapter);
    const generationId = "95000000-0000-0000-0000-000000000002";
    await repository.beginSentence({
      generationId,
      generationLeaseExpiresAt: "2026-08-13T03:12:00.000Z",
      generationLeaseToken: "quota-failure",
      idempotencyKey: "quota-failure",
      itemId,
      now: "2026-08-13T03:10:00.000Z",
      ownerUserId: userId,
      requestHash: "b".repeat(64),
      sessionId,
    });
    const generation = createPostgresPracticeGenerationRepository({
      database: adapter,
      ledgerId: nextId,
      now: () => new Date("2026-08-13T03:10:00.000Z"),
      priceVersionId: priceId,
      quota: {
        reserve: async () => {
          throw new CloudFault("quota_exhausted", "Quota exhausted.");
        },
        settle: async () => undefined,
        summary: async () => {
          throw new Error("unused");
        },
      },
      reservedMicroUsd: 100,
    });
    await expect(
      generation.acquire({
        generationId,
        input: { itemContent: "to be frank" },
        kind: "sentence-prompt",
        leaseToken: "quota-failure",
        ownerUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
    const rows = await database.query<{ current_generation_id: string | null; state: string }>(
      `SELECT sessions.current_generation_id::text,tasks.state FROM practice_sessions sessions
        JOIN practice_generation_tasks tasks ON tasks.session_id=sessions.id WHERE tasks.id=$1`,
      [generationId],
    );
    expect(rows.rows[0]).toEqual({ current_generation_id: null, state: "failed" });
  });

  it("settles a late provider failure after reservation cleanup released its amount", async () => {
    const generationId = "95000000-0000-0000-0000-000000000003";
    const reservationId = "96000000-0000-0000-0000-000000000003";
    await database.exec(`INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,
      period_start,reserved_micro_usd,status,expires_at)
      VALUES('${reservationId}','${userId}','${userId}','${generationId}',date_trunc('month',now()),
        100,'released',now()-interval '1 second');
      INSERT INTO practice_generation_tasks(id,owner_user_id,session_id,kind,state,request_hash,
        lease_token,lease_expires_at,reservation_id,price_version_id,reserved_micro_usd,dispatched_at)
      VALUES('${generationId}','${userId}','${sessionId}','sentence-prompt','dispatched',
        '${"c".repeat(64)}','late-failure',now()+interval '1 minute','${reservationId}',
        '${priceId}',100,now());
      UPDATE practice_sessions SET current_generation_id='${generationId}',
        generation_lease_token='late-failure',generation_lease_expires_at=now()+interval '1 minute'
        WHERE id='${sessionId}';`);
    const generation = createPostgresPracticeGenerationRepository({
      database: adapter,
      ledgerId: nextId,
      now: () => new Date(),
      priceVersionId: priceId,
      quota: {
        reserve: async () => ({ id: "unused" }),
        settle: async () => undefined,
        summary: async () => {
          throw new Error("unused");
        },
      },
      reservedMicroUsd: 100,
    });
    await generation.fail({
      generationId,
      input: { itemContent: "to be frank" },
      kind: "sentence-prompt",
      leaseToken: "late-failure",
      ownerUserId: userId,
      reservationId,
      stableErrorCode: "model_unavailable",
    });
    const rows = await database.query<{
      cost_micro_usd: string;
      current_generation_id: string | null;
      state: string;
      status: string;
    }>(
      `SELECT sessions.current_generation_id::text,tasks.state,reservations.status,
        ledger.cost_micro_usd::text FROM practice_generation_tasks tasks
        JOIN practice_sessions sessions ON sessions.id=tasks.session_id
        JOIN quota_reservations reservations ON reservations.id=tasks.reservation_id
        JOIN usage_ledger ledger ON ledger.request_id=tasks.id WHERE tasks.id=$1`,
      [generationId],
    );
    expect(rows.rows[0]).toEqual({
      cost_micro_usd: "100",
      current_generation_id: null,
      state: "failed",
      status: "settled",
    });
  });
});
