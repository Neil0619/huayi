const failureMessage = "Hosted Cloud Web DeepSeek production snapshot failed closed.";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

export const hostedDeepSeekPeakReservationMicroUsd = 50_463;

const usageKeys = Object.freeze([
  "cachedInputTokens",
  "costMicroUsd",
  "inputTokens",
  "ledgerEntryCount",
  "outputTokens",
]);
const preRowKeys = Object.freeze([
  "availableMicroUsd",
  "cachedInputTokens",
  "costMicroUsd",
  "estimatedPeakReservationMicroUsd",
  "inputTokens",
  "killSwitchEnabled",
  "ledgerEntryCount",
  "observedAt",
  "outputTokens",
]);
const postRowKeys = Object.freeze([
  "applicationRequestCountDelta",
  "cachedInputTokens",
  "costMicroUsd",
  "idempotencyKey",
  "inputTokens",
  "killSwitchEnabled",
  "ledgerEntryCount",
  "observedAt",
  "operationId",
  "outputTokens",
  "ownerId",
  "requestId",
  "reservationStatus",
  "terminalRequestCountDelta",
]);

const preSnapshotSql = `WITH operator_identity AS (
  SELECT bootstrap.operator_user_id AS owner_id
  FROM huayi_private.first_operator_bootstrap bootstrap
  JOIN public.user_profiles profiles
    ON profiles.user_id=bootstrap.operator_user_id AND profiles.status='active'
  JOIN public.admin_roles roles
    ON roles.user_id=bootstrap.operator_user_id AND roles.role='operator'
  WHERE bootstrap.singleton AND bootstrap.state='completed'
    AND bootstrap.operator_deleted_at IS NULL
), operator_contract AS (
  SELECT count(*)::integer AS identity_count, min(owner_id::text)::uuid AS owner_id
  FROM operator_identity
), quota AS (
  SELECT grants.limit_micro_usd,
    COALESCE((SELECT sum(ledger.cost_micro_usd) FROM public.usage_ledger ledger
      WHERE ledger.user_id=grants.user_id
        AND ledger.period_start=grants.period_start),0)::bigint AS used_micro_usd,
    COALESCE((SELECT sum(reservations.reserved_micro_usd)
      FROM public.quota_reservations reservations
      WHERE reservations.user_id=grants.user_id
        AND reservations.period_start=grants.period_start
        AND reservations.status='active'
        AND reservations.expires_at>clock_timestamp()),0)::bigint AS reserved_micro_usd
  FROM operator_contract operator
  JOIN public.quota_grants grants ON grants.user_id=operator.owner_id
  WHERE operator.identity_count=1
    AND grants.period_start=date_trunc('month',clock_timestamp())
    AND grants.period_end=date_trunc('month',clock_timestamp())+interval '1 month'
    AND grants.superseded_at IS NULL
), prices AS (
  SELECT count(*)::integer AS price_count,
    COALESCE(bool_and(provider='deepseek' AND model='deepseek-v4-flash' AND CASE id
      WHEN '8a7c5397-dbba-4e28-bc0d-107c4d04c3c3'::uuid THEN
        ROW(input_micro_usd_per_million,cached_input_micro_usd_per_million,
          output_micro_usd_per_million,effective_from)=
        ROW(140000::bigint,2800::bigint,280000::bigint,
          '2026-08-16T15:59:59Z'::timestamptz)
      WHEN 'dad0deb1-cbdc-4311-b3ad-b492c7ece757'::uuid THEN
        ROW(input_micro_usd_per_million,cached_input_micro_usd_per_million,
          output_micro_usd_per_million,effective_from)=
        ROW(220000::bigint,7000::bigint,660000::bigint,
          '2026-08-16T16:00:00Z'::timestamptz)
      WHEN 'e4479ddf-f4da-4a75-825a-2b25c1a145cf'::uuid THEN
        ROW(input_micro_usd_per_million,cached_input_micro_usd_per_million,
          output_micro_usd_per_million,effective_from)=
        ROW(440000::bigint,14000::bigint,1320000::bigint,
          '2026-08-16T16:00:01Z'::timestamptz)
      ELSE false END),false) AS exact
  FROM public.model_price_versions
  WHERE id IN (
    '8a7c5397-dbba-4e28-bc0d-107c4d04c3c3'::uuid,
    'dad0deb1-cbdc-4311-b3ad-b492c7ece757'::uuid,
    'e4479ddf-f4da-4a75-825a-2b25c1a145cf'::uuid
  )
), usage AS (
  SELECT count(ledger.id)::bigint AS ledger_entry_count,
    COALESCE(sum(ledger.input_tokens),0)::bigint AS input_tokens,
    COALESCE(sum(ledger.cached_input_tokens),0)::bigint AS cached_input_tokens,
    COALESCE(sum(ledger.output_tokens),0)::bigint AS output_tokens,
    COALESCE(sum(ledger.cost_micro_usd),0)::bigint AS cost_micro_usd
  FROM operator_contract operator
  LEFT JOIN public.usage_ledger ledger ON ledger.owner_user_id=operator.owner_id
  WHERE operator.identity_count=1
), control AS (
  SELECT count(*)::integer AS control_count,
    bool_and(enabled) AND huayi_private.effective_model_kill_switch_enabled() AS enabled
  FROM public.runtime_controls WHERE name='model_kill_switch'
)
SELECT
  greatest(0,quota.limit_micro_usd-quota.used_micro_usd-quota.reserved_micro_usd)::text
    AS "availableMicroUsd",
  $1::bigint::text AS "estimatedPeakReservationMicroUsd",
  control.enabled AS "killSwitchEnabled",
  clock_timestamp() AS "observedAt",
  usage.cached_input_tokens::text AS "cachedInputTokens",
  usage.cost_micro_usd::text AS "costMicroUsd",
  usage.input_tokens::text AS "inputTokens",
  usage.ledger_entry_count::text AS "ledgerEntryCount",
  usage.output_tokens::text AS "outputTokens"
FROM operator_contract operator, quota, prices, usage, control
WHERE operator.identity_count=1 AND prices.price_count=3 AND prices.exact
  AND control.control_count=1 AND control.enabled
  AND quota.limit_micro_usd-quota.used_micro_usd-quota.reserved_micro_usd >= $1`;

const postSnapshotSql = `WITH active_operation AS (
  SELECT operation.id AS operation_id, operation.owner_user_id,
    operation.payload_digest, operation.server_request_id
  FROM huayi_private.hosted_acceptance_operations operation
  JOIN huayi_private.hosted_acceptance_cleanup_obligations cleanup
    ON cleanup.operation_id=operation.id
  WHERE operation.state IN ('running','cleanup-pending')
    AND cleanup.state IN ('pending','claimed')
    AND operation.dispatch_attempted_at IS NOT NULL
    AND operation.server_request_id IS NOT NULL
    AND operation.receipt_digest IS NOT NULL
), operation_contract AS (
  SELECT count(*)::integer AS operation_count,
    min(operation_id::text)::uuid AS operation_id,
    min(owner_user_id::text)::uuid AS owner_id,
    min(payload_digest) AS payload_digest,
    min(server_request_id::text)::uuid AS request_id
  FROM active_operation
), request_evidence AS (
  SELECT requests.id AS request_id, requests.idempotency_key, requests.state,
    reservations.status AS reservation_status
  FROM operation_contract operation
  JOIN public.analysis_requests requests ON requests.id=operation.request_id
    AND requests.owner_user_id=operation.owner_id
    AND requests.request_hash=operation.payload_digest
  JOIN public.quota_reservations reservations ON reservations.id=requests.reservation_id
    AND reservations.request_id=requests.id AND reservations.owner_user_id=operation.owner_id
  WHERE operation.operation_count=1
), request_counts AS (
  SELECT count(*)::integer AS application_count,
    count(*) FILTER (WHERE requests.state IN ('completed','failed'))::integer AS terminal_count
  FROM operation_contract operation
  JOIN request_evidence selected ON true
  JOIN public.analysis_requests requests ON requests.owner_user_id=operation.owner_id
    AND requests.idempotency_key=selected.idempotency_key
    AND requests.request_hash=operation.payload_digest
), usage AS (
  SELECT count(ledger.id)::bigint AS ledger_entry_count,
    COALESCE(sum(ledger.input_tokens),0)::bigint AS input_tokens,
    COALESCE(sum(ledger.cached_input_tokens),0)::bigint AS cached_input_tokens,
    COALESCE(sum(ledger.output_tokens),0)::bigint AS output_tokens,
    COALESCE(sum(ledger.cost_micro_usd),0)::bigint AS cost_micro_usd
  FROM operation_contract operation
  LEFT JOIN public.usage_ledger ledger ON ledger.owner_user_id=operation.owner_id
  WHERE operation.operation_count=1
), control AS (
  SELECT count(*)::integer AS control_count,
    bool_and(enabled) AND huayi_private.effective_model_kill_switch_enabled() AS enabled
  FROM public.runtime_controls WHERE name='model_kill_switch'
)
SELECT request_counts.application_count AS "applicationRequestCountDelta",
  request_evidence.idempotency_key AS "idempotencyKey",
  control.enabled AS "killSwitchEnabled",
  clock_timestamp() AS "observedAt",
  operation.operation_id::text AS "operationId",
  operation.owner_id::text AS "ownerId",
  operation.request_id::text AS "requestId",
  request_evidence.reservation_status AS "reservationStatus",
  request_counts.terminal_count AS "terminalRequestCountDelta",
  usage.cached_input_tokens::text AS "cachedInputTokens",
  usage.cost_micro_usd::text AS "costMicroUsd",
  usage.input_tokens::text AS "inputTokens",
  usage.ledger_entry_count::text AS "ledgerEntryCount",
  usage.output_tokens::text AS "outputTokens"
FROM operation_contract operation, request_evidence, request_counts, usage, control
WHERE operation.operation_count=1 AND control.control_count=1 AND control.enabled`;

function fail() {
  throw new Error(failureMessage);
}

function hasExactKeys(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integer(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,15})$/u.test(value)) fail();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail();
  return parsed;
}

function timestamp(value) {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (
    typeof normalized !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(normalized) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    fail();
  }
  return normalized;
}

function oneRow(result, keys) {
  if (!Array.isArray(result?.rows) || result.rows.length !== 1) fail();
  const row = result.rows[0];
  if (!hasExactKeys(row, keys)) fail();
  return row;
}

function ownerUsage(row) {
  return Object.freeze(Object.fromEntries(usageKeys.map((key) => [key, integer(row[key])])));
}

export function createHostedDeepSeekProductionSnapshotReader({ query } = {}) {
  if (typeof query !== "function") fail();
  return Object.freeze({
    async readPostEvidence(control) {
      try {
        const row = oneRow(await query(postSnapshotSql, [], control), postRowKeys);
        if (
          ![0, 1].includes(row.applicationRequestCountDelta) ||
          ![0, 1].includes(row.terminalRequestCountDelta) ||
          row.killSwitchEnabled !== true ||
          !idempotencyKeyPattern.test(row.idempotencyKey ?? "") ||
          !uuidPattern.test(row.operationId ?? "") ||
          !uuidPattern.test(row.ownerId ?? "") ||
          !uuidPattern.test(row.requestId ?? "") ||
          !["active", "released", "settled"].includes(row.reservationStatus)
        ) {
          fail();
        }
        return Object.freeze({
          applicationRequestCountDelta: row.applicationRequestCountDelta,
          authority: "hosted-read-only-snapshot",
          killSwitchEnabled: true,
          observedAt: timestamp(row.observedAt),
          ownerUsage: ownerUsage(row),
          request: Object.freeze({
            idempotencyKey: row.idempotencyKey,
            operationId: row.operationId,
            ownerId: row.ownerId,
            requestId: row.requestId,
          }),
          reservationStatus: row.reservationStatus,
          terminalRequestCountDelta: row.terminalRequestCountDelta,
        });
      } catch {
        fail();
      }
    },
    async readPreEvidence(control) {
      try {
        const row = oneRow(
          await query(preSnapshotSql, [hostedDeepSeekPeakReservationMicroUsd], control),
          preRowKeys,
        );
        const estimatedPeakReservationMicroUsd = integer(row.estimatedPeakReservationMicroUsd);
        if (
          row.killSwitchEnabled !== true ||
          estimatedPeakReservationMicroUsd !== hostedDeepSeekPeakReservationMicroUsd
        ) {
          fail();
        }
        return Object.freeze({
          authority: "hosted-read-only-snapshot",
          budget: Object.freeze({
            availableMicroUsd: integer(row.availableMicroUsd),
            currency: "micro-usd",
            estimatedPeakReservationMicroUsd,
          }),
          killSwitchEnabled: true,
          observedAt: timestamp(row.observedAt),
          ownerUsage: ownerUsage(row),
        });
      } catch {
        fail();
      }
    },
  });
}
