-- Explicit operator action after migration 0024. Do not run as part of an application build.
-- Uses the existing Vault secrets and pg_cron/pg_net installation.
BEGIN;
CREATE OR REPLACE FUNCTION huayi_private.wake_learning_tasks() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE origin text; secret text;
BEGIN
  SELECT decrypted_secret INTO origin FROM vault.decrypted_secrets WHERE name='huayi_api_origin' ORDER BY created_at DESC LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='huayi_cron_secret' ORDER BY created_at DESC LIMIT 1;
  IF origin IS NULL OR origin !~ '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$' OR secret IS NULL OR length(secret) NOT BETWEEN 32 AND 512
    THEN RAISE EXCEPTION 'learning task scheduler configuration is invalid'; END IF;
  PERFORM net.http_get(url:=origin||'/internal/learning-tasks/run',params:='{}'::jsonb,
    headers:=jsonb_build_object('Authorization','Bearer '||secret,'Accept','application/json'),timeout_milliseconds:=115000);
END $$;
REVOKE ALL ON FUNCTION huayi_private.wake_learning_tasks() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='huayi-learning-tasks';
SELECT cron.schedule('huayi-learning-tasks','* * * * *',$cron$SELECT huayi_private.wake_learning_tasks();$cron$);
COMMIT;
