import { hostedAcceptancePriceVersionIds } from "./acceptance-hosted-foundation.mjs";

export function renderHostedRuntimeSnapshotSql() {
  const { legacy, offPeak, peak } = hostedAcceptancePriceVersionIds;
  return `BEGIN READ ONLY;

\\set cron_jobs_exact f
\\set cron_vault_names_exact f

SELECT to_regclass('cron.job') IS NOT NULL AS cron_catalog_ready,
  to_regclass('vault.secrets') IS NOT NULL AS vault_catalog_ready
\\gset

\\if :cron_catalog_ready
WITH expected_jobs(jobname,schedule,command,active) AS (
  VALUES
    ('huayi-password-recovery','* * * * *',
      $$SELECT huayi_private.invoke_cron_path('/internal/password-recovery/run');$$,true),
    ('huayi-data-rights','* * * * *',
      $$SELECT huayi_private.invoke_cron_path('/internal/data-rights/run');$$,true),
    ('huayi-extension-query-cleanup','* * * * *',
      $$SELECT huayi_private.invoke_cron_path('/internal/extension-queries/cleanup');$$,true),
    ('huayi-duplicate-suggestion-cleanup','* * * * *',
      $$SELECT huayi_private.invoke_cron_path('/internal/learning-duplicate-suggestions/cleanup');$$,true),
    ('huayi-security-notifications','* * * * *',
      $$SELECT huayi_private.invoke_cron_path('/internal/security-notifications/run');$$,true)
), actual_jobs AS (
  SELECT jobname,schedule,command,active
  FROM cron.job
  WHERE jobname LIKE 'huayi-%'
)
SELECT (SELECT count(*) FROM actual_jobs) = 5
  AND NOT EXISTS (SELECT * FROM expected_jobs EXCEPT SELECT * FROM actual_jobs)
  AND NOT EXISTS (SELECT * FROM actual_jobs EXCEPT SELECT * FROM expected_jobs)
  AS cron_jobs_exact
\\gset
\\endif

\\if :vault_catalog_ready
SELECT count(*) FILTER (WHERE name='huayi_api_origin') = 1
  AND count(*) FILTER (WHERE name='huayi_cron_secret') = 1
  AND count(*) = 2 AS cron_vault_names_exact
FROM vault.secrets
WHERE name IN ('huayi_api_origin','huayi_cron_secret')
\\gset
\\endif

WITH
r3c AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE status='pending')::bigint AS pending,
    count(*) FILTER (WHERE status='sending')::bigint AS sending,
    count(*) FILTER (WHERE status='sent')::bigint AS sent,
    count(*) FILTER (WHERE status='failed')::bigint AS failed,
    count(*) FILTER (WHERE status='dead-letter')::bigint AS dead_letter,
    count(*) FILTER (WHERE delivery_deadline_at > now() AND attempt_count < 8 AND (
      (status='pending' AND available_at <= now())
      OR (status='sending' AND lease_expires_at <= now())
    ))::bigint AS claimable,
    count(*) FILTER (WHERE delivery_deadline_at <= now()
      AND status NOT IN ('sent','failed','dead-letter'))::bigint AS overdue_nonterminal,
    COALESCE(max(attempt_count),0)::bigint AS max_attempts,
    count(*) FILTER (WHERE kind <> 'password-reset-completed'
      OR attempt_count < 0 OR attempt_count > 8
      OR delivery_deadline_at <> created_at + interval '23 hours'
      OR ((status='sending') <> (lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL))
      OR (status<>'sending' AND (lease_hash IS NOT NULL OR lease_expires_at IS NOT NULL))
      OR ((status='sent') <> (sent_at IS NOT NULL))
      OR (status='sent' AND attempt_count<1)
      OR (status='failed' AND delivery_deadline_at>now())
      OR (status='dead-letter' AND attempt_count<8)) = 0 AS contract_exact
  FROM public.security_notification_outbox
),
cron_extensions AS (
  SELECT count(*) FILTER (WHERE extensions.extname='pg_cron') = 1
    AND count(*) FILTER (WHERE extensions.extname='pg_net'
      AND namespaces.nspname='extensions') = 1
    AND count(*) FILTER (WHERE extensions.extname='supabase_vault'
      AND namespaces.nspname='vault') = 1 AS contract_exact
  FROM pg_extension AS extensions
  JOIN pg_namespace AS namespaces ON namespaces.oid=extensions.extnamespace
  WHERE extensions.extname IN ('pg_cron','pg_net','supabase_vault')
),
cron_function AS (
  SELECT procedures.oid,procedures.proowner,procedures.proacl,procedures.proconfig,
    procedures.prosecdef,procedures.prosrc,procedures.provolatile,languages.lanname
  FROM pg_proc AS procedures
  JOIN pg_namespace AS namespaces ON namespaces.oid=procedures.pronamespace
  JOIN pg_language AS languages ON languages.oid=procedures.prolang
  WHERE namespaces.nspname='huayi_private'
    AND procedures.proname='invoke_cron_path'
    AND procedures.prokind='f'
    AND procedures.pronargs=1
    AND procedures.proargtypes[0]='text'::regtype
    AND procedures.prorettype='bigint'::regtype
),
cron_function_contract AS (
  SELECT count(*) = 1 AND COALESCE(bool_and(prosecdef
    AND provolatile='v'
    AND lanname='plpgsql'
    AND proconfig=ARRAY['search_path=pg_catalog, net, vault']::text[]
    AND prosrc LIKE '%request_path NOT IN%'
    AND regexp_count(prosrc,$pattern$'/internal/$pattern$)=5
    AND prosrc LIKE '%''/internal/password-recovery/run''%'
    AND prosrc LIKE '%''/internal/data-rights/run''%'
    AND prosrc LIKE '%''/internal/extension-queries/cleanup''%'
    AND prosrc LIKE '%''/internal/learning-duplicate-suggestions/cleanup''%'
    AND prosrc LIKE '%''/internal/security-notifications/run''%'
    AND prosrc LIKE '%huayi_api_origin%'
    AND prosrc LIKE '%huayi_cron_secret%'
    AND prosrc LIKE '%net.http_get%'
    AND prosrc LIKE '%timeout_milliseconds := 55_000%'
    AND prosrc LIKE '%Authorization%'
    AND prosrc LIKE '%Bearer %'
    AND prosrc LIKE '%application/json%'),false) AS contract_exact
  FROM cron_function
),
cron_acl AS (
  SELECT (SELECT count(*)=1 AND COALESCE(bool_and(
      EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(functions.proacl,acldefault('f',functions.proowner))) AS acl
        WHERE acl.privilege_type='EXECUTE' AND acl.grantee=functions.proowner
      ) AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(functions.proacl,acldefault('f',functions.proowner))) AS acl
        WHERE acl.privilege_type='EXECUTE' AND acl.grantee<>functions.proowner
      )
    ),false) FROM cron_function AS functions)
    AND (SELECT count(*)=1 FROM pg_namespace WHERE nspname='huayi_private')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_namespace AS namespaces
      CROSS JOIN LATERAL aclexplode(
        COALESCE(namespaces.nspacl,acldefault('n',namespaces.nspowner))
      ) AS acl
      LEFT JOIN pg_roles AS roles ON roles.oid=acl.grantee
      WHERE namespaces.nspname='huayi_private'
        AND acl.privilege_type IN ('USAGE','CREATE')
        AND (acl.grantee=0 OR roles.rolname IN ('anon','authenticated','service_role'))
    ) AS contract_exact
),
deepseek_counts AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE state='running')::bigint AS running,
    count(*) FILTER (WHERE state='completed')::bigint AS completed,
    count(*) FILTER (WHERE state='failed')::bigint AS failed
  FROM public.analysis_requests
),
deepseek_record_count AS (
  SELECT count(*)::bigint AS total FROM public.analysis_records
),
deepseek_usage_count AS (
  SELECT count(*)::bigint AS total FROM public.usage_ledger WHERE feature='analysis'
),
latest_request AS (
  SELECT id,state,reservation_id,price_version_id,dispatched_at,terminal_event
  FROM public.analysis_requests
  ORDER BY created_at DESC,id DESC
  LIMIT 1
),
latest_price AS (
  SELECT prices.*
  FROM latest_request AS requests
  JOIN public.model_price_versions AS prices ON prices.id=requests.price_version_id
),
latest_reservation AS (
  SELECT reservations.id,reservations.request_id,reservations.reserved_micro_usd,
    reservations.status
  FROM latest_request AS requests
  JOIN public.quota_reservations AS reservations
    ON reservations.id=requests.reservation_id AND reservations.request_id=requests.id
),
latest_ledger AS (
  SELECT count(*)::bigint AS row_count,
    COALESCE(sum(ledger.input_tokens),0)::bigint AS input_tokens,
    COALESCE(sum(ledger.output_tokens),0)::bigint AS output_tokens,
    COALESCE(sum(ledger.cost_micro_usd),0)::bigint AS cost_micro_usd,
    CASE
      WHEN bool_and(ledger.outcome='succeeded') THEN 'succeeded'
      WHEN bool_and(ledger.outcome='failed') THEN 'failed'
      ELSE 'mixed'
    END AS outcome,
    COALESCE(bool_and(ledger.feature='analysis'
      AND ledger.price_version_id=requests.price_version_id
      AND prices.provider='deepseek' AND prices.model='deepseek-v4-flash'
      AND ledger.input_tokens IS NOT NULL
      AND ledger.cached_input_tokens IS NOT NULL
      AND ledger.output_tokens IS NOT NULL
      AND ledger.cached_input_tokens<=ledger.input_tokens
      AND ledger.cost_micro_usd =
        ceil(((ledger.input_tokens-ledger.cached_input_tokens)::numeric
          * prices.input_micro_usd_per_million)/1000000)::bigint
        + ceil((ledger.cached_input_tokens::numeric
          * prices.cached_input_micro_usd_per_million)/1000000)::bigint
        + ceil((ledger.output_tokens::numeric
          * prices.output_micro_usd_per_million)/1000000)::bigint),false)
      AND min(ledger.call_ordinal)=0
      AND max(ledger.call_ordinal)=count(*)-1
      AND count(DISTINCT ledger.call_ordinal)=count(*)
      AND count(*) BETWEEN 1 AND 2 AS contract_exact
  FROM latest_request AS requests
  JOIN public.usage_ledger AS ledger ON ledger.request_id=requests.id
  LEFT JOIN public.model_price_versions AS prices ON prices.id=ledger.price_version_id
  GROUP BY requests.id,requests.price_version_id
),
latest_record AS (
  SELECT count(records.id)::bigint AS row_count,
    COALESCE(bool_and(records.model_metadata->>'provider'='deepseek'
      AND records.model_metadata->>'model'='deepseek-v4-flash'
      AND records.model_metadata->>'promptVersion'='web-deep-analysis-v2'
      AND records.model_metadata->'schemaVersion'='2'::jsonb
      AND records.model_metadata->'inputTokens'=to_jsonb(ledger.input_tokens)
      AND records.model_metadata->'outputTokens'=to_jsonb(ledger.output_tokens)),false)
      AS metadata_reconciled
  FROM latest_request AS requests
  LEFT JOIN latest_ledger AS ledger ON true
  JOIN public.analysis_records AS records
    ON records.id::text=requests.terminal_event #>> '{analysis,id}'
),
latest_price_contract AS (
  SELECT count(*)=1 AND COALESCE(bool_and(provider='deepseek' AND model='deepseek-v4-flash'
    AND ((id='${legacy}' AND input_micro_usd_per_million=140000
      AND cached_input_micro_usd_per_million=2800 AND output_micro_usd_per_million=280000
      AND effective_from='2026-08-16T15:59:59Z'::timestamptz)
      OR (id='${offPeak}' AND input_micro_usd_per_million=220000
        AND cached_input_micro_usd_per_million=7000 AND output_micro_usd_per_million=660000
        AND effective_from='2026-08-16T16:00:00Z'::timestamptz)
      OR (id='${peak}' AND input_micro_usd_per_million=440000
        AND cached_input_micro_usd_per_million=14000 AND output_micro_usd_per_million=1320000
        AND effective_from='2026-08-16T16:00:01Z'::timestamptz))),false)
    AS contract_exact
  FROM latest_price
),
latest_reconciliation AS (
  SELECT EXISTS (
    SELECT 1
    FROM latest_request AS requests
    JOIN latest_reservation AS reservations ON true
    JOIN latest_ledger AS ledger ON true
    JOIN latest_record AS records ON true
    JOIN latest_price_contract AS prices ON true
    WHERE requests.state='completed'
      AND requests.terminal_event->>'type'='analysis.completed'
      AND requests.dispatched_at IS NOT NULL
      AND reservations.status='settled'
      AND ledger.row_count>=1 AND ledger.outcome='succeeded' AND ledger.contract_exact
      AND ledger.cost_micro_usd<=reservations.reserved_micro_usd
      AND records.row_count=1 AND records.metadata_reconciled
      AND prices.contract_exact
  ) AS reconciled
),
snapshot_rows(ordinal,field_name,field_value) AS (
  VALUES
    (1,'r3c_total',(SELECT total::text FROM r3c)),
    (2,'r3c_pending',(SELECT pending::text FROM r3c)),
    (3,'r3c_sending',(SELECT sending::text FROM r3c)),
    (4,'r3c_sent',(SELECT sent::text FROM r3c)),
    (5,'r3c_failed',(SELECT failed::text FROM r3c)),
    (6,'r3c_dead_letter',(SELECT dead_letter::text FROM r3c)),
    (7,'r3c_claimable',(SELECT claimable::text FROM r3c)),
    (8,'r3c_overdue_nonterminal',(SELECT overdue_nonterminal::text FROM r3c)),
    (9,'r3c_max_attempts',(SELECT max_attempts::text FROM r3c)),
    (10,'r3c_contract_exact',
      (SELECT CASE WHEN contract_exact THEN 't' ELSE 'f' END FROM r3c)),
    (11,'cron_extensions_exact',
      (SELECT CASE WHEN contract_exact THEN 't' ELSE 'f' END FROM cron_extensions)),
    (12,'cron_vault_names_exact',:'cron_vault_names_exact'),
    (13,'cron_jobs_exact',:'cron_jobs_exact'),
    (14,'cron_function_contract_exact',
      (SELECT CASE WHEN contract_exact THEN 't' ELSE 'f' END FROM cron_function_contract)),
    (15,'cron_acl_exact',
      (SELECT CASE WHEN contract_exact THEN 't' ELSE 'f' END FROM cron_acl)),
    (16,'deepseek_analysis_requests_total',(SELECT total::text FROM deepseek_counts)),
    (17,'deepseek_analysis_requests_running',(SELECT running::text FROM deepseek_counts)),
    (18,'deepseek_analysis_requests_completed',(SELECT completed::text FROM deepseek_counts)),
    (19,'deepseek_analysis_requests_failed',(SELECT failed::text FROM deepseek_counts)),
    (20,'deepseek_analysis_records_total',(SELECT total::text FROM deepseek_record_count)),
    (21,'deepseek_analysis_usage_rows_total',(SELECT total::text FROM deepseek_usage_count)),
    (22,'deepseek_latest_present',
      (SELECT CASE WHEN EXISTS(SELECT 1 FROM latest_request) THEN 't' ELSE 'f' END)),
    (23,'deepseek_latest_state',
      COALESCE((SELECT state::text FROM latest_request),'none')),
    (24,'deepseek_latest_dispatched',
      (SELECT CASE WHEN EXISTS(
        SELECT 1 FROM latest_request WHERE dispatched_at IS NOT NULL
      ) THEN 't' ELSE 'f' END)),
    (25,'deepseek_latest_price_slot',COALESCE((SELECT CASE price_version_id::text
      WHEN '${legacy}' THEN 'legacy'
      WHEN '${offPeak}' THEN 'off_peak'
      WHEN '${peak}' THEN 'peak'
      ELSE 'other' END FROM latest_request),'none')),
    (26,'deepseek_latest_price_contract',
      (SELECT CASE WHEN contract_exact THEN 't' ELSE 'f' END FROM latest_price_contract)),
    (27,'deepseek_latest_reservation_status',
      COALESCE((SELECT status::text FROM latest_reservation),'none')),
    (28,'deepseek_latest_ledger_rows',
      COALESCE((SELECT row_count::text FROM latest_ledger),'0')),
    (29,'deepseek_latest_ledger_outcome',
      COALESCE((SELECT outcome::text FROM latest_ledger),'none')),
    (30,'deepseek_latest_model_metadata_reconciled',
      COALESCE((SELECT CASE WHEN row_count=1 AND metadata_reconciled
        THEN 't' ELSE 'f' END FROM latest_record),'f')),
    (31,'deepseek_latest_reconciled',
      (SELECT CASE WHEN reconciled THEN 't' ELSE 'f' END FROM latest_reconciliation))
)
SELECT field_name || '|' || field_value
FROM snapshot_rows
ORDER BY ordinal;

ROLLBACK;
`;
}
