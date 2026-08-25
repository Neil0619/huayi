import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHostedRestoreFictionalToc,
  hostedRestoreFictionalCountOutput,
  hostedRestoreFictionalFixtureSql,
  hostedRestoreFictionalTargetAclSql,
  hostedRestoreFictionalVerificationOutput,
  hostedRestoreFictionalVerificationSql,
} from "./acceptance-hosted-restore-drill-fictional-fixture.mjs";

const validToc = `;
; Archive created at 2026-08-25 10:00:00 UTC
5; 1259 200 TABLE public profiles postgres
6; 1259 201 TABLE public analysis_jobs postgres
7; 1259 202 TABLE auth users postgres
8; 1259 203 TABLE auth identities postgres
9; 1259 204 TABLE storage buckets postgres
10; 1259 205 TABLE storage objects postgres
11; 1259 206 TABLE huayi_private audit_events postgres
12; 1259 207 TABLE supabase_migrations schema_migrations postgres
13; 1259 208 VIEW public admin_job_projection postgres
14; 0 200 TABLE DATA public profiles postgres
15; 0 201 TABLE DATA public analysis_jobs postgres
16; 0 202 TABLE DATA auth users postgres
17; 0 203 TABLE DATA auth identities postgres
18; 0 204 TABLE DATA storage buckets postgres
19; 0 205 TABLE DATA storage objects postgres
20; 0 206 TABLE DATA huayi_private audit_events postgres
21; 0 207 TABLE DATA supabase_migrations schema_migrations postgres
22; 2606 300 CONSTRAINT public profiles profiles_pkey postgres
23; 3256 301 POLICY public profiles owner_isolation postgres
24; 2620 302 TRIGGER public analysis_jobs audit_analysis_job postgres
`;

test("fictional fixture is two-tenant, data-bearing, and verifies body-free security markers", () => {
  assert.match(hostedRestoreFictionalFixtureSql, /00000000-0000-4000-8000-0000000000a1/u);
  assert.match(hostedRestoreFictionalFixtureSql, /00000000-0000-4000-8000-0000000000b2/u);
  assert.match(hostedRestoreFictionalFixtureSql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(hostedRestoreFictionalFixtureSql, /FORCE ROW LEVEL SECURITY/u);
  assert.match(hostedRestoreFictionalFixtureSql, /auth\.identities/u);
  assert.match(hostedRestoreFictionalFixtureSql, /storage\.objects/u);
  assert.match(hostedRestoreFictionalTargetAclSql, /REVOKE ALL ON ALL TABLES IN SCHEMA auth/u);
  assert.match(hostedRestoreFictionalVerificationSql, /SET LOCAL ROLE huayi_fixture_app/u);
  assert.match(hostedRestoreFictionalVerificationSql, /unknown_tenant_denied\|/u);
  assert.equal(
    hostedRestoreFictionalCountOutput,
    "profiles=2;analysis_jobs=2;auth_users=2;auth_identities=2;storage_buckets=1;storage_objects=0;audit_events=2;migrations=1\n",
  );
  assert.equal(hostedRestoreFictionalVerificationOutput.split("\n").filter(Boolean).length, 10);
});

test("fictional TOC accepts only the reviewed full archive surface", () => {
  assert.doesNotThrow(() => assertHostedRestoreFictionalToc(validToc));
  for (const mutation of [
    validToc.replace("TABLE DATA auth identities", "TABLE DATA public identities"),
    validToc.replace("TABLE storage objects", "EXTENSION - pg_net"),
    validToc.replace("POLICY public profiles owner_isolation", "ACL public profiles"),
    validToc.replace("TABLE DATA storage objects postgres\n", ""),
    `${validToc}25; 1259 400 TABLE public unexpected postgres\n`,
  ]) {
    assert.throws(
      () => assertHostedRestoreFictionalToc(mutation),
      /Hosted restore-drill fictional TOC failed/u,
    );
  }
});
