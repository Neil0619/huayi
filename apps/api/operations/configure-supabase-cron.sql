BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE SCHEMA IF NOT EXISTS huayi_private;
REVOKE ALL ON SCHEMA huayi_private FROM PUBLIC;
REVOKE ALL ON SCHEMA huayi_private FROM anon;
REVOKE ALL ON SCHEMA huayi_private FROM authenticated;
REVOKE ALL ON SCHEMA huayi_private FROM service_role;

CREATE OR REPLACE FUNCTION huayi_private.invoke_cron_path(request_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, net, vault
AS $function$
DECLARE
  api_origin text;
  cron_secret text;
  request_id bigint;
BEGIN
  IF request_path NOT IN (
    '/internal/password-recovery/run',
    '/internal/data-rights/run',
    '/internal/extension-queries/cleanup',
    '/internal/learning-duplicate-suggestions/cleanup'
  ) THEN
    RAISE EXCEPTION 'unsupported cron path';
  END IF;

  SELECT decrypted_secret
  INTO api_origin
  FROM vault.decrypted_secrets
  WHERE name = 'huayi_api_origin'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
  INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'huayi_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF api_origin IS NULL
    OR api_origin NOT LIKE 'https://%'
    OR api_origin !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$'
  THEN
    RAISE EXCEPTION 'invalid cron api origin';
  END IF;

  IF cron_secret IS NULL
    OR length(cron_secret) < 32
    OR length(cron_secret) > 512
  THEN
    RAISE EXCEPTION 'invalid cron secret';
  END IF;

  SELECT net.http_get(
    url := api_origin || request_path,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || cron_secret,
      'Accept',
      'application/json'
    ),
    timeout_milliseconds := 55_000
  )
  INTO request_id;

  RETURN request_id;
END;
$function$;

REVOKE ALL ON FUNCTION huayi_private.invoke_cron_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huayi_private.invoke_cron_path(text) FROM anon;
REVOKE ALL ON FUNCTION huayi_private.invoke_cron_path(text) FROM authenticated;
REVOKE ALL ON FUNCTION huayi_private.invoke_cron_path(text) FROM service_role;

DO $configuration$
DECLARE
  api_origin text;
  cron_secret text;
BEGIN
  SELECT decrypted_secret
  INTO api_origin
  FROM vault.decrypted_secrets
  WHERE name = 'huayi_api_origin'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
  INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'huayi_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF api_origin IS NULL
    OR api_origin NOT LIKE 'https://%'
    OR api_origin !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$'
  THEN
    RAISE EXCEPTION 'invalid cron api origin';
  END IF;

  IF cron_secret IS NULL
    OR length(cron_secret) < 32
    OR length(cron_secret) > 512
  THEN
    RAISE EXCEPTION 'invalid cron secret';
  END IF;
END;
$configuration$;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'huayi-password-recovery',
  'huayi-data-rights',
  'huayi-extension-query-cleanup',
  'huayi-duplicate-suggestion-cleanup'
);

SELECT cron.schedule(
  'huayi-password-recovery',
  '* * * * *',
  $$SELECT huayi_private.invoke_cron_path('/internal/password-recovery/run');$$
);

SELECT cron.schedule(
  'huayi-data-rights',
  '* * * * *',
  $$SELECT huayi_private.invoke_cron_path('/internal/data-rights/run');$$
);

SELECT cron.schedule(
  'huayi-extension-query-cleanup',
  '* * * * *',
  $$SELECT huayi_private.invoke_cron_path('/internal/extension-queries/cleanup');$$
);

SELECT cron.schedule(
  'huayi-duplicate-suggestion-cleanup',
  '* * * * *',
  $$SELECT huayi_private.invoke_cron_path('/internal/learning-duplicate-suggestions/cleanup');$$
);

COMMIT;
