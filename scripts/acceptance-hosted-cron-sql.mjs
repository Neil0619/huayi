import {
  hostedAcceptanceMigrationVersions,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";

export function renderHostedCronStatusSql() {
  const migrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  return `BEGIN READ ONLY;

\\set cron_fixed_jobs_count 0
\\set cron_jobs_exact f
\\set cron_unmanaged_jobs_count 0
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
), fixed_jobs AS (
  SELECT jobname,schedule,command,active
  FROM cron.job
  WHERE jobname IN (SELECT jobname FROM expected_jobs)
), unmanaged_jobs AS (
  SELECT jobid
  FROM cron.job
  WHERE jobname LIKE 'huayi-%' AND jobname NOT IN (SELECT jobname FROM expected_jobs)
)
SELECT (SELECT count(*) FROM fixed_jobs)::bigint AS cron_fixed_jobs_count,
  (SELECT count(*) FROM unmanaged_jobs)::bigint AS cron_unmanaged_jobs_count,
  ((SELECT count(*) FROM fixed_jobs)=5
    AND NOT EXISTS (SELECT * FROM expected_jobs EXCEPT SELECT * FROM fixed_jobs)
    AND NOT EXISTS (SELECT * FROM fixed_jobs EXCEPT SELECT * FROM expected_jobs))
    AS cron_jobs_exact
\\gset
\\endif

\\if :vault_catalog_ready
SELECT count(*) FILTER (WHERE name='huayi_api_origin')=1
  AND count(*) FILTER (WHERE name='huayi_cron_secret')=1
  AND count(*)=2 AS cron_vault_names_exact
FROM vault.secrets
WHERE name IN ('huayi_api_origin','huayi_cron_secret')
\\gset
\\endif

WITH
administrator AS (
  SELECT current_user='postgres'
    AND COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user),false)
    AS contract_exact
),
migrations AS (
  SELECT (SELECT array_agg(version::text ORDER BY version::text)
    FROM supabase_migrations.schema_migrations)=${migrations} AS contract_exact
),
r3c AS (
  SELECT count(*) FILTER (WHERE status='sent')::bigint AS sent_count,
    count(*) FILTER (WHERE status IN ('pending','sending'))::bigint AS nonterminal_count,
    count(*) FILTER (WHERE status IN ('failed','dead-letter'))::bigint
      AS terminal_failure_count,
    count(*) FILTER (WHERE kind<>'password-reset-completed'
      OR attempt_count<0 OR attempt_count>8
      OR delivery_deadline_at<>created_at+interval '23 hours'
      OR ((status='sending')<>(lease_hash IS NOT NULL AND lease_expires_at IS NOT NULL))
      OR (status<>'sending' AND (lease_hash IS NOT NULL OR lease_expires_at IS NOT NULL))
      OR ((status='sent')<>(sent_at IS NOT NULL))
      OR (status='sent' AND attempt_count<1)
      OR (status='failed' AND delivery_deadline_at>now())
      OR (status='dead-letter' AND attempt_count<8))=0 AS contract_exact
  FROM public.security_notification_outbox
),
extensions AS (
  SELECT NOT EXISTS (
      SELECT 1 FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid=extension.extnamespace
      WHERE (extension.extname='pg_net' AND namespace.nspname<>'extensions')
        OR (extension.extname='supabase_vault' AND namespace.nspname<>'vault')
    ) AND EXISTS (
      SELECT 1 FROM pg_extension AS extension
      JOIN pg_namespace AS namespace ON namespace.oid=extension.extnamespace
      WHERE extension.extname='supabase_vault' AND namespace.nspname='vault'
    ) AS installable,
    count(*) FILTER (WHERE extension.extname='pg_cron')=1
      AND count(*) FILTER (WHERE extension.extname='pg_net'
        AND namespace.nspname='extensions')=1
      AND count(*) FILTER (WHERE extension.extname='supabase_vault'
        AND namespace.nspname='vault')=1 AS contract_exact,
    count(*) FILTER (WHERE extension.extname='pg_cron')=1 AS cron_present
  FROM pg_extension AS extension
  JOIN pg_namespace AS namespace ON namespace.oid=extension.extnamespace
  WHERE extension.extname IN ('pg_cron','pg_net','supabase_vault')
),
named_functions AS (
  SELECT procedure.oid,procedure.proowner,procedure.proacl,procedure.proconfig,
    procedure.prosecdef,procedure.prosrc,procedure.provolatile,procedure.pronargs,
    procedure.proargtypes,procedure.prorettype,language.lanname
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
  JOIN pg_language AS language ON language.oid=procedure.prolang
  WHERE namespace.nspname='huayi_private'
    AND procedure.proname='invoke_cron_path' AND procedure.prokind='f'
),
target_function AS (
  SELECT * FROM named_functions
  WHERE pronargs=1 AND proargtypes[0]='text'::regtype AND prorettype='bigint'::regtype
),
function_contract AS (
  SELECT count(*)=1 AND COALESCE(bool_and(prosecdef AND provolatile='v'
    AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
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
  FROM target_function
),
function_safety AS (
  SELECT (SELECT count(*) FROM named_functions)=(SELECT count(*) FROM target_function)
    AND (SELECT count(*) FROM target_function)<=1
    AND NOT EXISTS (
      SELECT 1 FROM target_function
      WHERE proowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)
    )
    AND EXISTS (
      SELECT 1 FROM pg_namespace
      WHERE nspname='huayi_private'
        AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    )
    AND NOT EXISTS (
      SELECT 1 FROM target_function AS function
      CROSS JOIN LATERAL aclexplode(
        COALESCE(function.proacl,acldefault('f',function.proowner))
      ) AS acl
      LEFT JOIN pg_roles AS role ON role.oid=acl.grantee
      WHERE acl.privilege_type='EXECUTE' AND acl.grantee<>function.proowner
        AND acl.grantee<>0
        AND COALESCE(role.rolname,'') NOT IN ('anon','authenticated','service_role')
    ) AS installable
),
schema_acl AS (
  SELECT count(*)=4
    AND count(*) FILTER (WHERE acl.is_grantable)=0
    AND count(*) FILTER (WHERE acl.grantee=namespace.nspowner
      AND acl.privilege_type='USAGE')=1
    AND count(*) FILTER (WHERE acl.grantee=namespace.nspowner
      AND acl.privilege_type='CREATE')=1
    AND count(*) FILTER (WHERE role.rolname='huayi_context_setter'
      AND acl.privilege_type='USAGE')=1
    AND count(*) FILTER (WHERE role.rolname='huayi_business'
      AND acl.privilege_type='USAGE')=1 AS contract_exact
  FROM pg_namespace AS namespace
  CROSS JOIN LATERAL aclexplode(
    COALESCE(namespace.nspacl,acldefault('n',namespace.nspowner))
  ) AS acl
  LEFT JOIN pg_roles AS role ON role.oid=acl.grantee
  WHERE namespace.nspname='huayi_private'
),
function_acl AS (
  SELECT (SELECT count(*)=1 AND COALESCE(bool_and(
      EXISTS (
        SELECT 1 FROM aclexplode(
          COALESCE(function.proacl,acldefault('f',function.proowner))
        ) AS acl
        WHERE acl.privilege_type='EXECUTE' AND acl.grantee=function.proowner
      ) AND NOT EXISTS (
        SELECT 1 FROM aclexplode(
          COALESCE(function.proacl,acldefault('f',function.proowner))
        ) AS acl
        WHERE acl.privilege_type='EXECUTE' AND acl.grantee<>function.proowner
      )
    ),false) FROM target_function AS function)
    AS contract_exact
),
status AS (
  SELECT administrator.contract_exact AS administrator_exact,
    migrations.contract_exact AS migration_exact,
    r3c.sent_count,r3c.nonterminal_count,r3c.terminal_failure_count,
    r3c.contract_exact AS r3c_exact,
    extensions.installable AS extensions_installable,
    extensions.contract_exact AS extensions_exact,
    extensions.cron_present,
    function_safety.installable AS function_installable,
    function_contract.contract_exact AS function_exact,
    (function_acl.contract_exact AND schema_acl.contract_exact) AS acl_exact,
    (extensions.contract_exact AND :'cron_vault_names_exact'::boolean
      AND :'cron_jobs_exact'::boolean AND function_contract.contract_exact
      AND function_acl.contract_exact AND schema_acl.contract_exact) AS installation_exact,
    (administrator.contract_exact AND migrations.contract_exact
      AND r3c.sent_count>=1 AND r3c.nonterminal_count=0
      AND r3c.terminal_failure_count=0 AND r3c.contract_exact
      AND :'cron_vault_names_exact'::boolean AND extensions.installable
      AND :'cron_unmanaged_jobs_count'::bigint=0 AND function_safety.installable
      AND schema_acl.contract_exact)
      AS preflight_ready,
    (NOT extensions.cron_present AND :'cron_fixed_jobs_count'::bigint=0
      AND NOT EXISTS (SELECT 1 FROM target_function)) AS installation_absent
  FROM administrator,migrations,r3c,extensions,function_safety,function_contract,function_acl,
    schema_acl
),
status_rows(ordinal,field_name,field_value) AS (
  VALUES
    (1,'administrator_connection_exact',(SELECT CASE WHEN administrator_exact THEN 't' ELSE 'f' END FROM status)),
    (2,'migration_chain_exact',(SELECT CASE WHEN migration_exact THEN 't' ELSE 'f' END FROM status)),
    (3,'r3c_sent_count',(SELECT sent_count::text FROM status)),
    (4,'r3c_nonterminal_count',(SELECT nonterminal_count::text FROM status)),
    (5,'r3c_terminal_failure_count',(SELECT terminal_failure_count::text FROM status)),
    (6,'r3c_contract_exact',(SELECT CASE WHEN r3c_exact THEN 't' ELSE 'f' END FROM status)),
    (7,'cron_vault_names_exact',:'cron_vault_names_exact'),
    (8,'cron_extensions_installable',(SELECT CASE WHEN extensions_installable THEN 't' ELSE 'f' END FROM status)),
    (9,'cron_extensions_exact',(SELECT CASE WHEN extensions_exact THEN 't' ELSE 'f' END FROM status)),
    (10,'cron_fixed_jobs_count',:'cron_fixed_jobs_count'),
    (11,'cron_unmanaged_jobs_count',:'cron_unmanaged_jobs_count'),
    (12,'cron_jobs_exact',:'cron_jobs_exact'),
    (13,'cron_function_installable',(SELECT CASE WHEN function_installable THEN 't' ELSE 'f' END FROM status)),
    (14,'cron_function_contract_exact',(SELECT CASE WHEN function_exact THEN 't' ELSE 'f' END FROM status)),
    (15,'cron_acl_exact',(SELECT CASE WHEN acl_exact THEN 't' ELSE 'f' END FROM status)),
    (16,'cron_installation_state',(SELECT CASE WHEN installation_exact THEN 'exact'
      WHEN installation_absent THEN 'absent' ELSE 'partial' END FROM status)),
    (17,'cron_preflight_ready',(SELECT CASE WHEN preflight_ready THEN 't' ELSE 'f' END FROM status)),
    (18,'cron_installation_exact',(SELECT CASE WHEN installation_exact THEN 't' ELSE 'f' END FROM status))
)
SELECT field_name || '|' || field_value FROM status_rows ORDER BY ordinal;

ROLLBACK;
`;
}
