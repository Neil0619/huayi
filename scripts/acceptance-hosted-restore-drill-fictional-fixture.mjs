const ownerA = "00000000-0000-4000-8000-0000000000a1";
const ownerB = "00000000-0000-4000-8000-0000000000b2";
const unknownOwner = "00000000-0000-4000-8000-0000000000c3";

const fixtureObjects = new Map([
  [
    "auth",
    new Set([
      "identities",
      "identities_pkey",
      "identities_user_id_fkey",
      "users",
      "users_email_key",
      "users_pkey",
    ]),
  ],
  [
    "huayi_private",
    new Set(["audit_events", "audit_events_pkey", "record_analysis_job", "record_analysis_job()"]),
  ],
  [
    "public",
    new Set([
      "admin_job_projection",
      "analysis_jobs",
      "analysis_jobs_owner_user_id_fkey",
      "analysis_jobs_pkey",
      "audit_analysis_job",
      "owner_isolation",
      "profiles",
      "profiles_pkey",
    ]),
  ],
  [
    "storage",
    new Set(["buckets", "buckets_pkey", "objects", "objects_bucket_id_fkey", "objects_pkey"]),
  ],
  ["supabase_migrations", new Set(["schema_migrations", "schema_migrations_pkey"])],
]);
const allowedTypes = [
  "FK CONSTRAINT",
  "TABLE DATA",
  "CONSTRAINT",
  "POLICY",
  "ROW SECURITY",
  "TABLE",
  "TRIGGER",
  "VIEW",
];
const forbiddenTypes = new Set([
  "ACL",
  "BLOB",
  "DATABASE",
  "DEFAULT ACL",
  "EVENT TRIGGER",
  "EXTENSION",
  "FOREIGN DATA WRAPPER",
  "FOREIGN SERVER",
  "PROCEDURAL LANGUAGE",
  "PUBLICATION",
  "SUBSCRIPTION",
]);
const requiredTocEntries = [
  "TABLE:public:profiles",
  "TABLE:public:analysis_jobs",
  "TABLE:auth:users",
  "TABLE:auth:identities",
  "TABLE:storage:buckets",
  "TABLE:storage:objects",
  "TABLE:huayi_private:audit_events",
  "TABLE:supabase_migrations:schema_migrations",
  "VIEW:public:admin_job_projection",
  "TABLE DATA:public:profiles",
  "TABLE DATA:public:analysis_jobs",
  "TABLE DATA:auth:users",
  "TABLE DATA:auth:identities",
  "TABLE DATA:storage:buckets",
  "TABLE DATA:storage:objects",
  "TABLE DATA:huayi_private:audit_events",
  "TABLE DATA:supabase_migrations:schema_migrations",
  "POLICY:public:profiles",
  "TRIGGER:public:analysis_jobs",
];

function failToc() {
  throw new Error("Hosted restore-drill fictional TOC failed.");
}

function parseTocEntry(line) {
  const payload = /^\d+; \d+ \d+ (.+)$/u.exec(line)?.[1];
  if (payload === undefined) failToc();
  const type = allowedTypes.find((candidate) => payload.startsWith(`${candidate} `));
  if (type === undefined || forbiddenTypes.has(type)) failToc();
  const tokens = payload.slice(type.length + 1).split(" ");
  if (tokens.length < 3) failToc();
  const [schema, name] = tokens;
  if (!fixtureObjects.get(schema)?.has(name)) failToc();
  return `${type}:${schema}:${name}`;
}

export function assertHostedRestoreFictionalToc(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 65_536) failToc();
  const entries = new Set();
  for (const line of source.split("\n")) {
    if (line.length === 0 || line.startsWith(";")) continue;
    entries.add(parseTocEntry(line));
  }
  if (requiredTocEntries.some((entry) => !entries.has(entry))) failToc();
}

export const hostedRestoreFictionalFixtureSql = `/* fictional_fixture */
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_fixture_app') THEN
    CREATE ROLE huayi_fixture_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
DROP VIEW IF EXISTS public.admin_job_projection CASCADE;
DROP TABLE IF EXISTS public.analysis_jobs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA IF EXISTS huayi_private CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA huayi_private;
CREATE SCHEMA supabase_migrations;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL CHECK (status = 'active')
);
CREATE TABLE public.analysis_jobs (
  job_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(user_id),
  input_text text NOT NULL,
  status text NOT NULL CHECK (status = 'complete')
);
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  confirmed_at timestamptz NOT NULL
);
CREATE TABLE auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  provider text NOT NULL CHECK (provider = 'email')
);
CREATE TABLE storage.buckets (id text PRIMARY KEY);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY,
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  owner_id uuid NOT NULL,
  path text NOT NULL
);
CREATE TABLE huayi_private.audit_events (
  job_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL
);
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON public.profiles USING (
  owner_user_id = nullif(current_setting('huayi.owner_user_id', true), '')::uuid
);
CREATE POLICY owner_isolation ON public.analysis_jobs USING (
  owner_user_id = nullif(current_setting('huayi.owner_user_id', true), '')::uuid
);
CREATE FUNCTION huayi_private.record_analysis_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, huayi_private AS $$
BEGIN
  INSERT INTO huayi_private.audit_events(job_id, owner_user_id)
  VALUES (NEW.job_id, NEW.owner_user_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_analysis_job AFTER INSERT ON public.analysis_jobs
FOR EACH ROW EXECUTE FUNCTION huayi_private.record_analysis_job();
CREATE VIEW public.admin_job_projection WITH (security_invoker = true) AS
SELECT job_id, status FROM public.analysis_jobs;
INSERT INTO public.profiles VALUES
  ('${ownerA}', '${ownerA}', 'owner-a@fictional.invalid', 'active'),
  ('${ownerB}', '${ownerB}', 'owner-b@fictional.invalid', 'active');
INSERT INTO auth.users VALUES
  ('${ownerA}', 'owner-a@fictional.invalid', '2026-08-25T00:00:00Z'),
  ('${ownerB}', 'owner-b@fictional.invalid', '2026-08-25T00:00:00Z');
INSERT INTO auth.identities VALUES
  ('10000000-0000-4000-8000-0000000000a1', '${ownerA}', 'email'),
  ('10000000-0000-4000-8000-0000000000b2', '${ownerB}', 'email');
INSERT INTO storage.buckets VALUES ('analysis-exports');
INSERT INTO public.analysis_jobs VALUES
  ('20000000-0000-4000-8000-0000000000a1', '${ownerA}', 'fictional body a', 'complete'),
  ('20000000-0000-4000-8000-0000000000b2', '${ownerB}', 'fictional body b', 'complete');
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260824010000');
`;

export const hostedRestoreFictionalTargetBootstrapSql = `/* fictional_target_bootstrap */
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_fixture_app') THEN
    CREATE ROLE huayi_fixture_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
DROP VIEW IF EXISTS public.admin_job_projection CASCADE;
DROP TABLE IF EXISTS public.analysis_jobs CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA IF EXISTS huayi_private CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE SCHEMA huayi_private;
CREATE SCHEMA supabase_migrations;
CREATE FUNCTION huayi_private.record_analysis_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, huayi_private AS $$
BEGIN
  INSERT INTO huayi_private.audit_events(job_id, owner_user_id)
  VALUES (NEW.job_id, NEW.owner_user_id);
  RETURN NEW;
END;
$$;
`;

export const hostedRestoreFictionalTargetAclSql = `/* fictional_target_acl */
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM huayi_fixture_app;
REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM huayi_fixture_app;
REVOKE ALL ON SCHEMA huayi_private FROM huayi_fixture_app;
GRANT USAGE ON SCHEMA public TO huayi_fixture_app;
GRANT SELECT ON public.profiles, public.analysis_jobs, public.admin_job_projection
TO huayi_fixture_app;
`;

export const hostedRestoreFictionalCountSql = `/* count_contract */
SELECT 'profiles=' || (SELECT count(*) FROM public.profiles) ||
  ';analysis_jobs=' || (SELECT count(*) FROM public.analysis_jobs) ||
  ';auth_users=' || (SELECT count(*) FROM auth.users) ||
  ';auth_identities=' || (SELECT count(*) FROM auth.identities) ||
  ';storage_buckets=' || (SELECT count(*) FROM storage.buckets) ||
  ';storage_objects=' || (SELECT count(*) FROM storage.objects) ||
  ';audit_events=' || (SELECT count(*) FROM huayi_private.audit_events) ||
  ';migrations=' || (SELECT count(*) FROM supabase_migrations.schema_migrations);
`;

export const hostedRestoreFictionalCountOutput =
  "profiles=2;analysis_jobs=2;auth_users=2;auth_identities=2;storage_buckets=1;storage_objects=0;audit_events=2;migrations=1\n";

export const hostedRestoreFictionalVerificationSql = `/* verification_contract */
SELECT 'schema_exact|' || CASE WHEN
  to_regclass('public.profiles') IS NOT NULL AND
  to_regclass('public.analysis_jobs') IS NOT NULL AND
  to_regclass('auth.users') IS NOT NULL AND
  to_regclass('auth.identities') IS NOT NULL AND
  to_regclass('storage.buckets') IS NOT NULL AND
  to_regclass('storage.objects') IS NOT NULL
THEN 't' ELSE 'f' END;
SELECT 'migration_head_exact|' || CASE WHEN
  (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) =
    ARRAY['20260824010000']::text[]
THEN 't' ELSE 'f' END;
SELECT 'rls_forced_exact|' || CASE WHEN (
  SELECT bool_and(relrowsecurity AND relforcerowsecurity)
  FROM pg_class WHERE oid IN ('public.profiles'::regclass, 'public.analysis_jobs'::regclass)
) THEN 't' ELSE 'f' END;
SELECT 'role_graph_exact|' || CASE WHEN EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'huayi_fixture_app' AND NOT rolcanlogin
    AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
) AND NOT pg_has_role('huayi_fixture_app', 'postgres', 'MEMBER') THEN 't' ELSE 'f' END;
SELECT 'application_auth_denied|' || CASE WHEN
  NOT has_table_privilege('huayi_fixture_app', 'auth.users', 'SELECT') AND
  NOT has_table_privilege('huayi_fixture_app', 'auth.identities', 'SELECT') AND
  NOT has_schema_privilege('huayi_fixture_app', 'public', 'CREATE')
THEN 't' ELSE 'f' END;
SELECT 'admin_projection_exact|' || CASE WHEN (
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'admin_job_projection'
) = ARRAY['job_id', 'status']::text[] THEN 't' ELSE 'f' END;
SELECT 'storage_metadata_exact|' || CASE WHEN
  (SELECT array_agg(id ORDER BY id) FROM storage.buckets) = ARRAY['analysis-exports']::text[] AND
  NOT EXISTS (SELECT 1 FROM storage.objects)
THEN 't' ELSE 'f' END;
SELECT 'trigger_exact|' || CASE WHEN
  (SELECT count(*) FROM huayi_private.audit_events) = 2 AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.analysis_jobs'::regclass AND tgname = 'audit_analysis_job'
      AND NOT tgisinternal
  ) THEN 't' ELSE 'f' END;
BEGIN;
SET LOCAL ROLE huayi_fixture_app;
DO $$ BEGIN PERFORM set_config('huayi.owner_user_id', '${ownerA}', true); END $$;
SELECT 'cross_tenant_denied|' || CASE WHEN
  (SELECT count(*) FROM public.profiles) = 1 AND
  (SELECT count(*) FROM public.analysis_jobs) = 1 AND
  (SELECT count(*) FROM public.admin_job_projection) = 1
THEN 't' ELSE 'f' END;
DO $$ BEGIN PERFORM set_config('huayi.owner_user_id', '${unknownOwner}', true); END $$;
SELECT 'unknown_tenant_denied|' || CASE WHEN
  NOT EXISTS (SELECT 1 FROM public.profiles) AND
  NOT EXISTS (SELECT 1 FROM public.analysis_jobs)
THEN 't' ELSE 'f' END;
ROLLBACK;
`;

export const hostedRestoreFictionalVerificationOutput = `schema_exact|t
migration_head_exact|t
rls_forced_exact|t
role_graph_exact|t
application_auth_denied|t
admin_projection_exact|t
storage_metadata_exact|t
trigger_exact|t
cross_tenant_denied|t
unknown_tenant_denied|t
`;
