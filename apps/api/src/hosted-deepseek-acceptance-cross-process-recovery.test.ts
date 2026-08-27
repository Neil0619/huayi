import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createHostedAcceptanceHmacKeyring,
  createHostedDeepSeekPostgresAuthority,
} from "../../../scripts/acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";
import { createHostedDeepSeekPostgresEvidence } from "../../../scripts/acceptance-hosted-deepseek-one-shot-postgres-evidence.mjs";
import {
  createHostedDeepSeekOneShotExecutor,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekPayloadDigest,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
} from "../../../scripts/acceptance-hosted-deepseek-one-shot.mjs";

const migrationNames = [
  "0001-cloud-v1-foundation.sql",
  "0012-first-operator-bootstrap.sql",
  "0016-hosted-deepseek-acceptance-authority.sql",
  "0017-hosted-deepseek-acceptance-retention-scrub.sql",
  "0018-hosted-deepseek-acceptance-status.sql",
  "0019-hosted-deepseek-acceptance-effective-fuse.sql",
  "0020-hosted-deepseek-acceptance-authority-mutations.sql",
  "0021-hosted-deepseek-acceptance-evidence.sql",
] as const;
const operationId = "70000000-0000-4000-8000-000000000001";
const ownerId = "71000000-0000-4000-8000-000000000001";
const requestId = "72000000-0000-4000-8000-000000000001";
const invitationId = "73000000-0000-4000-8000-000000000001";
const priceVersionId = "dad0deb1-cbdc-4311-b3ad-b492c7ece757";
const recordId = "75000000-0000-4000-8000-000000000001";
const reservationId = "76000000-0000-4000-8000-000000000001";
const ledgerId = "77000000-0000-4000-8000-000000000001";
const secondRequestId = "72000000-0000-4000-8000-000000000002";
const candidateCommit = "b".repeat(40);
const deployments = Object.freeze({
  api: Object.freeze({
    commit: "d".repeat(40),
    deploymentId: "dpl_apiCandidate",
    state: "READY",
  }),
  web: Object.freeze({
    commit: "f".repeat(40),
    deploymentId: "dpl_webCandidate",
    state: "READY",
  }),
});
const approval = Object.freeze({
  candidateCommit,
  confirmation: hostedDeepSeekOneShotConfirmation,
  maximumReservationMicroUsd: 50_000,
});
interface DispatchedIdentity {
  idempotencyKey: string;
  operationId: string;
  ownerId: string;
}

async function applyMigrations(database: PGlite): Promise<void> {
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE TABLE auth.identities (id text PRIMARY KEY, user_id uuid NOT NULL);
  `);
  for (const name of migrationNames) {
    await database.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  await database.exec(`
    INSERT INTO auth.users(id) VALUES ('${ownerId}');
    INSERT INTO public.user_profiles(
      user_id,owner_user_id,email,status,timezone,daily_goal
    ) VALUES (
      '${ownerId}','${ownerId}','operator@example.test','active','Asia/Shanghai',5
    );
    INSERT INTO public.admin_roles(user_id,role) VALUES ('${ownerId}','operator');
    INSERT INTO public.invitations(
      id,token_hash,expires_at,consumed_at,created_by,created_by_kind
    ) VALUES (
      '${invitationId}',repeat('i',43),now()+interval '1 day',now(),NULL,
      'deployment-bootstrap'
    );
    INSERT INTO huayi_private.first_operator_bootstrap(
      singleton,state,current_invitation_id,revision,issued_at,completed_at,operator_user_id
    ) VALUES (true,'completed','${invitationId}',1,now(),now(),'${ownerId}');
  `);
}

function timestamp(): string {
  return new Date().toISOString();
}

function authorization() {
  const observedAt = timestamp();
  return {
    access: "full",
    observedAt,
    operator: true,
    reauthenticatedAt: observedAt,
  };
}

function preSnapshot() {
  return {
    authority: "hosted-read-only-snapshot",
    budget: {
      availableMicroUsd: 1_000_000,
      currency: "micro-usd",
      estimatedPeakReservationMicroUsd: 40_000,
    },
    candidate: {
      branch: "codex/phase-b-authority",
      clean: true,
      commit: candidateCommit,
      pushed: true,
      upstreamCommit: candidateCommit,
    },
    deployments,
    killSwitchEnabled: true,
    observedAt: timestamp(),
    ownerUsage: {
      cachedInputTokens: 0,
      costMicroUsd: 0,
      inputTokens: 0,
      ledgerEntryCount: 0,
      outputTokens: 0,
    },
    route: { origin: hostedDeepSeekWebOrigin, path: hostedDeepSeekWebPath },
  };
}

function restorationSnapshot() {
  return {
    applicationRequestCountDelta: 1,
    authority: "hosted-read-only-snapshot",
    deployments,
    killSwitchEnabled: true,
    observedAt: timestamp(),
    ownerUsage: {
      cachedInputTokens: 0,
      costMicroUsd: 63,
      inputTokens: 120,
      ledgerEntryCount: 1,
      outputTokens: 60,
    },
    request: null,
    reservationStatus: "settled",
    terminalRequestCountDelta: 1,
  };
}

async function expireOperationLease(database: PGlite): Promise<void> {
  await database.exec(`
    ALTER TABLE huayi_private.hosted_acceptance_operations
      DISABLE TRIGGER hosted_acceptance_operation_state_guard;
    UPDATE huayi_private.hosted_acceptance_operations
    SET lease_expires_at=now()-interval '1 second'
    WHERE id='${operationId}';
    ALTER TABLE huayi_private.hosted_acceptance_operations
      ENABLE TRIGGER hosted_acceptance_operation_state_guard;
  `);
}

async function completeDispatchedAnalysis(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO public.model_price_versions(
      id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from
    ) VALUES (
      '${priceVersionId}','deepseek','deepseek-v4-flash',220000,7000,660000,
      '2026-08-16T16:00:00Z'
    );
    INSERT INTO public.quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,
      expires_at,created_at,updated_at
    ) VALUES (
      '${reservationId}','${ownerId}','${ownerId}','${requestId}',
      date_trunc('month',now()),40000,'settled',now()+interval '1 minute',now(),now()
    );
    INSERT INTO public.analysis_records(
      id,owner_user_id,review_state,source_type,source_text,source_normalized_hash,
      selection_kind,result,model_metadata,revision,created_at,updated_at
    ) VALUES (
      '${recordId}','${ownerId}','pendingReview','manual','private source text',
      repeat('9',64),'sentence','{}'::jsonb,
      '{"provider":"deepseek","model":"deepseek-v4-flash","promptVersion":"web-deep-analysis-v2","schemaVersion":2,"inputTokens":120,"outputTokens":60}'::jsonb,
      1,now(),now()
    );
    INSERT INTO public.usage_ledger(
      id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
      input_tokens,cached_input_tokens,output_tokens,price_version_id,cost_micro_usd,
      outcome,created_at
    ) VALUES (
      '${ledgerId}','${ownerId}','${ownerId}','${requestId}',0,date_trunc('month',now()),
      'analysis',120,20,60,'${priceVersionId}',63,'succeeded',now()
    );
    UPDATE public.analysis_requests
    SET state='completed',reservation_id='${reservationId}',
        price_version_id='${priceVersionId}',dispatched_at=now(),
        terminal_event=jsonb_build_object(
          'type','analysis.completed','analysis',jsonb_build_object('id','${recordId}')
        ),updated_at=now()
    WHERE id='${requestId}';
  `);
}

describe("Hosted DeepSeek shared-Postgres cross-process recovery", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await applyMigrations(database);
  });

  afterEach(async () => database.close());

  it.each([
    { expectedOutcome: "accepted", reconciliationCount: 1 },
    { expectedOutcome: "failed", reconciliationCount: 0 },
    { expectedOutcome: "failed", reconciliationCount: 2 },
  ])(
    "recovers dispatch-before-bind with $reconciliationCount exact reconciliation rows",
    async ({ expectedOutcome, reconciliationCount }) => {
      const query = async (text: string, parameters: unknown[]) => database.query(text, parameters);
      const oldKey = Buffer.alloc(32, 1);
      const newKey = Buffer.alloc(32, 2);
      const firstAuthority = createHostedDeepSeekPostgresAuthority({
        keyring: createHostedAcceptanceHmacKeyring({
          activeVersion: 1,
          keys: new Map([[1, oldKey]]),
        }),
        query,
        randomBytes_: () => Buffer.alloc(32, 3),
        randomUUID_: () => operationId,
      });
      let applicationPostCount = 0;
      let resolveDispatch: () => void = () => undefined;
      const dispatchReached = new Promise<void>((resolve) => {
        resolveDispatch = resolve;
      });
      let dispatchedIdentity: DispatchedIdentity | undefined;
      const firstAdapter = {
        capturePostSnapshot: async () => restorationSnapshot(),
        capturePreSnapshot: async () => preSnapshot(),
        destroySession: () => undefined,
        invokeCloudWebAnalysis: async (request: DispatchedIdentity) => {
          applicationPostCount += 1;
          dispatchedIdentity = request;
          resolveDispatch();
          return new Promise(() => undefined);
        },
        loginPassword: async () => undefined,
        logout: async () => undefined,
        readOperatorAuthorization: async () => authorization(),
        readServerSettlement: async () => undefined,
        reauthenticatePassword: async () => undefined,
        reconcileDispatchedRequest: async () => ({ complete: true, matches: [] }),
        setModelKillSwitch: async () => undefined,
      };
      const firstExecutor = createHostedDeepSeekOneShotExecutor({
        adapter: firstAdapter,
        clearTimeout_: () => undefined,
        lifecycle: firstAuthority,
        setTimeout_: () => 1,
      });
      void firstExecutor.execute(approval).catch(() => undefined);
      await dispatchReached;
      expect(dispatchedIdentity).toMatchObject({ operationId, ownerId });
      expect(applicationPostCount).toBe(1);
      if (dispatchedIdentity === undefined) {
        throw new Error("dispatch identity was not captured");
      }

      await database.query(
        `INSERT INTO public.analysis_requests(
          id,owner_user_id,idempotency_key,request_hash,unit_count,state,lease_token,
          lease_expires_at,recovery_ledger_id
        ) VALUES ($1,$2,$3,$4,1,'running','product-lease',now()+interval '1 minute',$5)`,
        [
          requestId,
          ownerId,
          dispatchedIdentity.idempotencyKey,
          hostedDeepSeekPayloadDigest,
          priceVersionId,
        ],
      );
      await completeDispatchedAnalysis(database);
      await expireOperationLease(database);

      const restartedAuthority = createHostedDeepSeekPostgresAuthority({
        keyring: createHostedAcceptanceHmacKeyring({
          activeVersion: 2,
          keys: new Map([
            [1, oldKey],
            [2, newKey],
          ]),
        }),
        query,
        randomBytes_: () => Buffer.alloc(32, 4),
      });
      let reconcileCount = 0;
      let restartedPostCount = 0;
      const postgresEvidence = createHostedDeepSeekPostgresEvidence({ query });
      const restartedAdapter = {
        capturePostSnapshot: async () => restorationSnapshot(),
        capturePreSnapshot: async () => preSnapshot(),
        destroySession: () => undefined,
        invokeCloudWebAnalysis: async () => {
          restartedPostCount += 1;
          throw new Error("recovery must not dispatch");
        },
        loginPassword: async () => undefined,
        logout: async () => undefined,
        readOperatorAuthorization: async () => authorization(),
        readServerSettlement: postgresEvidence.readServerSettlement,
        reauthenticatePassword: async () => undefined,
        reconcileDispatchedRequest: async (request: {
          idempotencyKey: string;
          ownerId: string;
          payloadDigest: string;
        }) => {
          reconcileCount += 1;
          const exact = {
            idempotencyKey: request.idempotencyKey,
            ownerId: request.ownerId,
            payloadDigest: request.payloadDigest,
            requestId,
          };
          return {
            complete: true,
            matches:
              reconciliationCount === 2
                ? [exact, { ...exact, requestId: secondRequestId }]
                : reconciliationCount === 1
                  ? [exact]
                  : [],
          };
        },
        setModelKillSwitch: async () => undefined,
      };
      const restartedExecutor = createHostedDeepSeekOneShotExecutor({
        adapter: restartedAdapter,
        lifecycle: restartedAuthority,
      });

      if (expectedOutcome === "accepted") {
        await expect(restartedExecutor.recover()).resolves.toEqual({
          killSwitchRestored: true,
          outcome: "accepted",
        });
      } else {
        await expect(restartedExecutor.recover()).rejects.toThrow(
          "Hosted Cloud Web DeepSeek one-shot failed closed.",
        );
      }

      expect(applicationPostCount).toBe(1);
      expect(restartedPostCount).toBe(0);
      expect(reconcileCount).toBe(1);
      const authority = await database.query<{
        cleanupState: string;
        hmacVersion: number;
        operationState: string;
        receiptRecorded: boolean;
        requestId: string | null;
        safeErrorCode: string | null;
      }>(`
        SELECT
          cleanup.state AS "cleanupState",
          operation.idempotency_hmac_version AS "hmacVersion",
          operation.state AS "operationState",
          operation.receipt_digest IS NOT NULL AS "receiptRecorded",
          operation.server_request_id::text AS "requestId",
          operation.safe_error_code AS "safeErrorCode"
        FROM huayi_private.hosted_acceptance_operations operation
        JOIN huayi_private.hosted_acceptance_cleanup_obligations cleanup
          ON cleanup.operation_id=operation.id
        WHERE operation.id='${operationId}'
      `);
      expect(authority.rows).toEqual([
        {
          cleanupState: "completed",
          hmacVersion: 1,
          operationState: "terminal",
          receiptRecorded: expectedOutcome === "accepted",
          requestId: expectedOutcome === "accepted" ? requestId : null,
          safeErrorCode: expectedOutcome === "accepted" ? null : "internal_safe_failure",
        },
      ]);
    },
  );
});
