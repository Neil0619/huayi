import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  createHostedDeepSeekProductionSnapshotReader,
  hostedDeepSeekPeakReservationMicroUsd,
} from "./acceptance-hosted-deepseek-one-shot-production-snapshot.mjs";

const observedAt = "2026-09-02T10:00:00.000Z";
const operationId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000002";
const requestId = "30000000-0000-4000-8000-000000000003";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

function usage(overrides = {}) {
  return {
    cachedInputTokens: "10",
    costMicroUsd: "20",
    inputTokens: "30",
    ledgerEntryCount: "1",
    outputTokens: "40",
    ...overrides,
  };
}

test("production snapshot reader returns only the strict preflight evidence projection", async () => {
  const calls = [];
  const control = { signal: new AbortController().signal };
  const reader = createHostedDeepSeekProductionSnapshotReader({
    query: async (sql, parameters, actualControl) => {
      calls.push({ actualControl, parameters, sql });
      return {
        rows: [
          {
            availableMicroUsd: "1000000",
            estimatedPeakReservationMicroUsd: String(hostedDeepSeekPeakReservationMicroUsd),
            killSwitchEnabled: true,
            observedAt,
            ...usage(),
          },
        ],
      };
    },
  });

  assert.deepEqual(await reader.readPreEvidence(control), {
    authority: "hosted-read-only-snapshot",
    budget: {
      availableMicroUsd: 1_000_000,
      currency: "micro-usd",
      estimatedPeakReservationMicroUsd: hostedDeepSeekPeakReservationMicroUsd,
    },
    killSwitchEnabled: true,
    observedAt,
    ownerUsage: {
      cachedInputTokens: 10,
      costMicroUsd: 20,
      inputTokens: 30,
      ledgerEntryCount: 1,
      outputTokens: 40,
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].parameters, [hostedDeepSeekPeakReservationMicroUsd]);
  assert.equal(calls[0].actualControl, control);
  assert.match(calls[0].sql, /first_operator_bootstrap/u);
  assert.match(calls[0].sql, /model_price_versions/u);
  assert.match(calls[0].sql, /effective_model_kill_switch_enabled/u);
  assert.doesNotMatch(calls[0].sql, /email|password|token_hash/iu);
});

test("production snapshot reader binds post evidence to one durable operation and request", async () => {
  const reader = createHostedDeepSeekProductionSnapshotReader({
    query: async (sql) => {
      assert.match(sql, /hosted_acceptance_operations/u);
      assert.match(sql, /hosted_acceptance_cleanup_obligations/u);
      assert.doesNotMatch(sql, /source_text|model_output|terminal_event/iu);
      return {
        rows: [
          {
            applicationRequestCountDelta: 1,
            idempotencyKey: "hda_hosted_acceptance_001",
            killSwitchEnabled: true,
            observedAt,
            operationId,
            ownerId,
            requestId,
            reservationStatus: "settled",
            terminalRequestCountDelta: 1,
            ...usage({
              cachedInputTokens: "15",
              costMicroUsd: "27",
              inputTokens: "50",
              ledgerEntryCount: "2",
              outputTokens: "60",
            }),
          },
        ],
      };
    },
  });

  assert.deepEqual(await reader.readPostEvidence({}), {
    applicationRequestCountDelta: 1,
    authority: "hosted-read-only-snapshot",
    killSwitchEnabled: true,
    observedAt,
    ownerUsage: {
      cachedInputTokens: 15,
      costMicroUsd: 27,
      inputTokens: 50,
      ledgerEntryCount: 2,
      outputTokens: 60,
    },
    request: {
      idempotencyKey: "hda_hosted_acceptance_001",
      operationId,
      ownerId,
      requestId,
    },
    reservationStatus: "settled",
    terminalRequestCountDelta: 1,
  });
});

test("production snapshot reader fails closed on malformed, extra, or unsafe evidence", async () => {
  const unsafeRows = [
    [],
    [{ availableMicroUsd: "1" }, { availableMicroUsd: "1" }],
    [
      {
        availableMicroUsd: "1000000",
        estimatedPeakReservationMicroUsd: String(hostedDeepSeekPeakReservationMicroUsd),
        killSwitchEnabled: true,
        observedAt,
        secret: "must-not-pass",
        ...usage(),
      },
    ],
    [
      {
        availableMicroUsd: "9007199254740992",
        estimatedPeakReservationMicroUsd: String(hostedDeepSeekPeakReservationMicroUsd),
        killSwitchEnabled: true,
        observedAt,
        ...usage(),
      },
    ],
  ];
  for (const rows of unsafeRows) {
    const reader = createHostedDeepSeekProductionSnapshotReader({
      query: async () => ({ rows }),
    });
    await assert.rejects(
      reader.readPreEvidence({}),
      /^Error: Hosted Cloud Web DeepSeek production snapshot failed closed\.$/u,
    );
  }
});

test("production snapshot SQL executes against the through-0021 schema for pre and post evidence", async () => {
  const database = new PGlite();
  await database.waitReady;
  try {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    const migrationFiles = (
      await readdir(new URL("../apps/api/migrations", import.meta.url))
    ).sort();
    for (const filename of migrationFiles.slice(0, 21)) {
      await database.exec(
        await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
      );
    }
    await database.exec(`
      INSERT INTO public.user_profiles(
        user_id,owner_user_id,email,status,timezone,daily_goal
      ) VALUES(
        '${ownerId}','${ownerId}','operator@example.test','active','UTC',10
      );
      INSERT INTO public.invitations(
        id,token_hash,expires_at,consumed_at,created_by,created_by_kind
      ) VALUES(
        '50000000-0000-4000-8000-000000000005',
        '${"a".repeat(43)}',now()+interval '1 day',now(),NULL,'deployment-bootstrap'
      );
      INSERT INTO huayi_private.first_operator_bootstrap(
        singleton,state,current_invitation_id,revision,issued_at,completed_at,operator_user_id
      ) VALUES(
        true,'completed','50000000-0000-4000-8000-000000000005',1,
        now()-interval '1 day',now(),'${ownerId}'
      );
      INSERT INTO public.admin_roles(user_id,role) VALUES('${ownerId}','operator');
      INSERT INTO public.quota_grants(
        id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
      ) VALUES(
        '60000000-0000-4000-8000-000000000006','${ownerId}','${ownerId}',
        date_trunc('month',now()),date_trunc('month',now())+interval '1 month',
        1000000,'default'
      );
      INSERT INTO public.model_price_versions(
        id,provider,model,input_micro_usd_per_million,
        cached_input_micro_usd_per_million,output_micro_usd_per_million,effective_from
      ) VALUES
        ('8a7c5397-dbba-4e28-bc0d-107c4d04c3c3','deepseek','deepseek-v4-flash',
          140000,2800,280000,'2026-08-16T15:59:59Z'),
        ('dad0deb1-cbdc-4311-b3ad-b492c7ece757','deepseek','deepseek-v4-flash',
          220000,7000,660000,'2026-08-16T16:00:00Z'),
        ('e4479ddf-f4da-4a75-825a-2b25c1a145cf','deepseek','deepseek-v4-flash',
          440000,14000,1320000,'2026-08-16T16:00:01Z');
      INSERT INTO public.runtime_controls(name,enabled,updated_by)
      VALUES('model_kill_switch',true,'${ownerId}');
    `);
    const reader = createHostedDeepSeekProductionSnapshotReader({
      query: async (sql, parameters) => ({
        rows: (await database.query(sql, parameters)).rows,
      }),
    });
    const pre = await reader.readPreEvidence();
    assert.equal(pre.budget.availableMicroUsd, 1_000_000);
    assert.deepEqual(pre.ownerUsage, {
      cachedInputTokens: 0,
      costMicroUsd: 0,
      inputTokens: 0,
      ledgerEntryCount: 0,
      outputTokens: 0,
    });

    await database.exec(`
      INSERT INTO public.quota_reservations(
        id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
      ) VALUES(
        '70000000-0000-4000-8000-000000000007','${ownerId}','${ownerId}',
        '${requestId}',date_trunc('month',now()),1000,'settled',now()+interval '1 minute'
      );
      INSERT INTO public.analysis_requests(
        id,owner_user_id,idempotency_key,request_hash,unit_count,state,lease_token,
        lease_expires_at,reservation_id,price_version_id,dispatched_at,recovery_ledger_id,
        terminal_event
      ) VALUES(
        '${requestId}','${ownerId}','hda_hosted_acceptance_001','${"b".repeat(64)}',1,
        'completed','fictional-lease',now()+interval '1 minute',
        '70000000-0000-4000-8000-000000000007',
        'dad0deb1-cbdc-4311-b3ad-b492c7ece757',now(),
        '80000000-0000-4000-8000-000000000008','{"type":"analysis.completed"}'::jsonb
      );
      INSERT INTO public.usage_ledger(
        id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,input_tokens,
        cached_input_tokens,output_tokens,price_version_id,cost_micro_usd,outcome
      ) VALUES(
        '90000000-0000-4000-8000-000000000009','${ownerId}','${ownerId}',
        '${requestId}',0,date_trunc('month',now()),'analysis',100,10,20,
        'dad0deb1-cbdc-4311-b3ad-b492c7ece757',99,'succeeded'
      );
      INSERT INTO huayi_private.hosted_acceptance_operations(
        id,approval_digest,candidate_commit,maximum_reservation_micro_usd,payload_digest,
        api_deployment_id,api_source_commit,web_deployment_id,web_source_commit,state,
        owner_user_id,idempotency_key_hmac,dispatch_attempted_at,server_request_id,
        receipt_digest,lease_generation,idempotency_hmac_context,idempotency_hmac_version
      ) VALUES(
        '${operationId}','${"c".repeat(64)}','${"d".repeat(40)}',50463,'${"b".repeat(64)}',
        'dpl_ApiAcceptance001','${"e".repeat(40)}','dpl_WebAcceptance001',
        '${"f".repeat(40)}','cleanup-pending','${ownerId}','${"1".repeat(64)}',now(),
        '${requestId}','${"2".repeat(64)}',1,
        'huayi.hosted-deepseek-one-shot.idempotency.v1',1
      );
      INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(
        operation_id,state,desired_kill_switch_enabled
      ) VALUES('${operationId}','pending',true);
    `);
    const post = await reader.readPostEvidence();
    assert.equal(post.applicationRequestCountDelta, 1);
    assert.equal(post.terminalRequestCountDelta, 1);
    assert.equal(post.request.operationId, operationId);
    assert.equal(post.request.requestId, requestId);
    assert.equal(post.reservationStatus, "settled");
    assert.deepEqual(post.ownerUsage, {
      cachedInputTokens: 10,
      costMicroUsd: 99,
      inputTokens: 100,
      ledgerEntryCount: 1,
      outputTokens: 20,
    });
  } finally {
    await database.close();
  }
});
