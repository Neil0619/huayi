const apiOrigin = "https://api.acceptance.seen-said.cn";

export function renderEnsureVaultSourceSql() {
  return `
BEGIN;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
DO $cron_source$
DECLARE
  api_origin_id uuid;
  cron_secret_id uuid;
  cron_secret_value text;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'huayi_api_origin') > 1
    OR (SELECT count(*) FROM vault.secrets WHERE name = 'huayi_cron_secret') > 1
  THEN
    RAISE EXCEPTION 'Hosted Cron Vault names are ambiguous.';
  END IF;

  SELECT id INTO api_origin_id FROM vault.secrets WHERE name = 'huayi_api_origin';
  IF api_origin_id IS NULL THEN
    PERFORM vault.create_secret(
      '${apiOrigin}', 'huayi_api_origin', '语见 Hosted API origin'
    );
  ELSE
    PERFORM vault.update_secret(
      api_origin_id, '${apiOrigin}', 'huayi_api_origin', '语见 Hosted API origin'
    );
  END IF;

  SELECT id INTO cron_secret_id FROM vault.secrets WHERE name = 'huayi_cron_secret';
  IF cron_secret_id IS NULL THEN
    cron_secret_value := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    PERFORM vault.create_secret(
      cron_secret_value, 'huayi_cron_secret', '语见 Hosted Cron bearer'
    );
  END IF;

  SELECT decrypted_secret INTO cron_secret_value
  FROM vault.decrypted_secrets WHERE name = 'huayi_cron_secret';
  IF cron_secret_value !~ '^[0-9a-f]{64}$'
    OR (SELECT count(*) FROM vault.secrets
        WHERE name IN ('huayi_api_origin', 'huayi_cron_secret')) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM vault.decrypted_secrets
      WHERE name = 'huayi_api_origin' AND decrypted_secret = '${apiOrigin}'
    )
  THEN
    RAISE EXCEPTION 'Hosted Cron Vault source is invalid.';
  END IF;
END;
$cron_source$;
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'huayi_cron_secret';
COMMIT;
`;
}

export function renderReadVaultSourceSql() {
  return `
BEGIN READ ONLY;
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'huayi_cron_secret';
COMMIT;
`;
}
