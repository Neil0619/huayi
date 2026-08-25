import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHostedRestoreExecutionPlan,
  hostedRestoreTocAllowlistSha256,
} from "./acceptance-hosted-restore-drill-plan.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";

function entries() {
  return [
    { id: 1, name: "profiles", objectKind: "TABLE", schema: "public", section: "pre-data" },
    {
      id: 2,
      name: "profiles",
      objectKind: "TABLE DATA",
      schema: "public",
      section: "data",
    },
    {
      id: 3,
      name: "users",
      objectKind: "TABLE DATA",
      schema: "auth",
      section: "auth-data",
    },
    {
      id: 4,
      name: "objects",
      objectKind: "TABLE DATA",
      schema: "storage",
      section: "storage-data",
    },
    {
      id: 5,
      name: "profiles_owner_idx",
      objectKind: "INDEX",
      schema: "public",
      section: "post-data",
    },
    {
      id: 6,
      name: "profiles_id_seq",
      objectKind: "SEQUENCE SET",
      schema: "public",
      section: "sequence",
    },
  ];
}

function fixture() {
  const tocEntries = entries();
  const tocAllowlistSha256 = hostedRestoreTocAllowlistSha256(tocEntries);
  return {
    archiveEntries: tocEntries,
    reviewedPlan: {
      contract: "huayi-hosted-restore-reviewed-plan/v1",
      coverageProfile: "reviewed-production-coverage/v1",
      entries: tocEntries,
      migrationHead: "20260824010000",
      sourceCandidateCommit: commit,
      tocAllowlistSha256,
    },
    sourceAttestation: {
      coverageProfile: "reviewed-production-coverage/v1",
      migrationHead: "20260824010000",
      sourceCandidateCommit: commit,
      tocAllowlistSha256,
    },
    targetEmptyVerdict: {
      authRowsEmpty: true,
      outboundIntegrationsAbsent: true,
      platformBaselineExact: true,
      productSchemasAbsent: true,
      storageRowsEmpty: true,
      targetIdentityDigest: "b".repeat(64),
    },
  };
}

test("reviewed TOC produces the fixed restore stage order without source ACL or owner", () => {
  const plan = buildHostedRestoreExecutionPlan(fixture());
  assert.deepEqual(
    plan.operations.map(({ stage }) => stage),
    [
      "role-bootstrap",
      "pre-data",
      "data",
      "auth-data",
      "storage-data",
      "post-data",
      "acl",
      "sequence",
      "verify",
    ],
  );
  assert.deepEqual(plan.operations.find(({ stage }) => stage === "acl").entryIds, []);
  assert.equal(JSON.stringify(plan).includes("owner"), false);
});

test("restore plan rejects TOC drift, unsafe kinds, target drift and source binding drift", () => {
  const reorder = fixture();
  reorder.archiveEntries = [...reorder.archiveEntries].reverse();
  assert.throws(() => buildHostedRestoreExecutionPlan(reorder));

  const unsafe = fixture();
  unsafe.archiveEntries[0] = { ...unsafe.archiveEntries[0], objectKind: "ACL" };
  unsafe.reviewedPlan.entries[0] = unsafe.archiveEntries[0];
  assert.throws(() => buildHostedRestoreExecutionPlan(unsafe));

  const nonempty = fixture();
  nonempty.targetEmptyVerdict.authRowsEmpty = false;
  assert.throws(() => buildHostedRestoreExecutionPlan(nonempty));

  const stale = fixture();
  stale.sourceAttestation.sourceCandidateCommit = "f".repeat(40);
  assert.throws(() => buildHostedRestoreExecutionPlan(stale));
});
