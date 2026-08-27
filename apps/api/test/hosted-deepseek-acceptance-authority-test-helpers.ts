import { readFile } from "node:fs/promises";

import type { PGlite } from "@electric-sql/pglite";

export const operationId = "70000000-0000-4000-8000-000000000001";
export const ownerId = "71000000-0000-4000-8000-000000000001";
export const requestId = "72000000-0000-4000-8000-000000000001";
export const operationToken = "operation_token_material_00000000000000000001";
export const verifier = "e".repeat(64);
export const forwardUrl = new URL(
  "../migrations/0020-hosted-deepseek-acceptance-authority-mutations.sql",
  import.meta.url,
);
export const supabaseForwardUrl = new URL(
  "../../../supabase/migrations/20260827050000_hosted_deepseek_acceptance_authority_mutations.sql",
  import.meta.url,
);
export const evidenceForwardUrl = new URL(
  "../migrations/0021-hosted-deepseek-acceptance-evidence.sql",
  import.meta.url,
);
export const supabaseEvidenceForwardUrl = new URL(
  "../../../supabase/migrations/20260827060000_hosted_deepseek_acceptance_evidence.sql",
  import.meta.url,
);

const invitationId = "73000000-0000-4000-8000-000000000001";
const recordId = "75000000-0000-4000-8000-000000000001";
const reservationId = "76000000-0000-4000-8000-000000000001";
export const hostedAcceptancePriceVersionId = "dad0deb1-cbdc-4311-b3ad-b492c7ece757";
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

export async function applyHostedAcceptanceMigrations(database: PGlite): Promise<void> {
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

export async function claimOperation(database: PGlite, id = operationId): Promise<void> {
  await database.query(
    `SELECT * FROM huayi_private.claim_hosted_acceptance_operation(
      $1,repeat('a',64),repeat('b',40),50000,repeat('c',64),
      'dpl_apiCandidate',repeat('d',40),'dpl_webCandidate',repeat('f',40),
      $2,1,$3
    )`,
    [id, verifier, operationToken],
  );
}

export async function armCleanup(database: PGlite): Promise<void> {
  await database.query(
    `SELECT * FROM huayi_private.arm_hosted_acceptance_cleanup(
      $1,1,$2,$3
    )`,
    [operationId, operationToken, operationToken],
  );
}

export async function expireOperationLease(database: PGlite): Promise<void> {
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

export async function insertAnalysisRequest(
  database: PGlite,
  id = requestId,
  idempotencyKey = "recovered-idempotency-key",
): Promise<void> {
  await database.query(
    `
    INSERT INTO public.analysis_requests(
      id,owner_user_id,idempotency_key,request_hash,unit_count,state,lease_token,
      lease_expires_at,recovery_ledger_id
    ) VALUES (
      $1,'${ownerId}',$2,repeat('c',64),1,
      'running','product-lease',now()+interval '1 minute',
      '74000000-0000-4000-8000-000000000001'
    );
  `,
    [id, idempotencyKey],
  );
}

export async function seedCompletedAnalysis(
  database: PGlite,
  options: { readonly callOrdinals?: readonly number[]; readonly owner?: string } = {},
): Promise<void> {
  const requestOwner = options.owner ?? ownerId;
  const ordinals = options.callOrdinals ?? [0];
  await database.exec(`
    INSERT INTO public.model_price_versions(
      id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from
    ) VALUES (
      '${hostedAcceptancePriceVersionId}','deepseek','deepseek-v4-flash',220000,7000,660000,
      '2026-08-16T16:00:00Z'
    );
    INSERT INTO public.analysis_requests(
      id,owner_user_id,idempotency_key,request_hash,unit_count,state,lease_token,
      lease_expires_at,recovery_ledger_id
    ) VALUES (
      '${requestId}','${requestOwner}','recovered-idempotency-key',repeat('c',64),1,
      'running','product-lease',now()+interval '1 minute',
      '74000000-0000-4000-8000-000000000001'
    );
    INSERT INTO public.quota_reservations(
      id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,
      expires_at,created_at,updated_at
    ) VALUES (
      '${reservationId}','${requestOwner}','${requestOwner}','${requestId}',
      date_trunc('month',now()),400,'settled',now()+interval '1 minute',now(),now()
    );
    INSERT INTO public.analysis_records(
      id,owner_user_id,review_state,source_type,source_text,source_normalized_hash,
      selection_kind,result,model_metadata,revision,created_at,updated_at
    ) VALUES (
      '${recordId}','${requestOwner}','pendingReview','manual','private source text',
      repeat('9',64),'sentence','{}'::jsonb,
      '{"provider":"deepseek","model":"deepseek-v4-flash","promptVersion":"web-deep-analysis-v2","schemaVersion":2,"inputTokens":120,"outputTokens":60}'::jsonb,
      1,now(),now()
    );
  `);
  for (const [index, ordinal] of ordinals.entries()) {
    const inputTokens = ordinals.length === 1 ? 120 : 60;
    const cachedInputTokens = ordinals.length === 1 ? 20 : 10;
    const outputTokens = ordinals.length === 1 ? 60 : 30;
    const costMicroUsd = ordinals.length === 1 ? 63 : 32;
    await database.exec(`
      INSERT INTO public.usage_ledger(
        id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
        input_tokens,cached_input_tokens,output_tokens,price_version_id,cost_micro_usd,
        outcome,created_at
      ) VALUES (
        '77000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}',
        '${requestOwner}','${requestOwner}','${requestId}',${ordinal},date_trunc('month',now()),
        'analysis',${inputTokens},${cachedInputTokens},${outputTokens},
        '${hostedAcceptancePriceVersionId}',${costMicroUsd},'succeeded',now()
      );
    `);
  }
  await database.exec(`
    UPDATE public.analysis_requests
    SET state='completed',reservation_id='${reservationId}',
        price_version_id='${hostedAcceptancePriceVersionId}',dispatched_at=now(),
        terminal_event=jsonb_build_object(
          'type','analysis.completed','analysis',jsonb_build_object('id','${recordId}')
        ),updated_at=now()
    WHERE id='${requestId}';
  `);
}
