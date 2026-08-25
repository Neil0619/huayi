import assert from "node:assert/strict";
import test from "node:test";

import { createHostedRestoreVerification } from "./acceptance-hosted-restore-drill-verification.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const digest = "a".repeat(64);
const base = {
  drillId: "seen-said-recovery-2026-q3-0123456789abcdef",
  now: () => new Date("2026-08-25T02:00:00.000Z"),
  securityVerdict: {
    adminProjectionExact: true,
    applicationRoleAccessExact: true,
    authRelationalContractExact: true,
    crossTenantDenied: true,
    migrationHeadExact: true,
    ownerContextIsolationExact: true,
    platformConfigUntouched: true,
    platformRolesUntouched: true,
    platformRuntimeExact: true,
    productSchemaExact: true,
    rlsForcedExact: true,
    sourceInspectionScratchDestroyedExact: true,
    targetRoleGraphExact: true,
    unknownTenantDenied: true,
  },
  sourceAttestation: {
    sourceCandidateCommit: commit,
    storageExportManifestSha256: null,
    storageObjectBytesMode: "source-empty",
  },
  sourceAttestationSha256: digest,
  sourceCounts: { "auth.users": 2, "public.profiles": 2, "storage.objects": 0 },
  storageVerdict: {
    databaseMetadataExact: true,
    restoredObjectCount: 0,
    separateExportBytesExact: false,
    separateExportManifestSha256: null,
    sourceObjectCount: 0,
  },
  targetCounts: { "auth.users": 2, "public.profiles": 2, "storage.objects": 0 },
  targetIdentityDigest: "b".repeat(64),
  toolCandidateCommit: commit,
};

test("body-free verification emits only equal HMAC digests and strict security booleans", () => {
  const evidence = createHostedRestoreVerification({
    ...base,
    hmacKey: Buffer.alloc(32, 7),
  });
  assert.equal(evidence.sourceCountDigest, evidence.targetCountDigest);
  assert.match(evidence.sourceCountDigest, /^[0-9a-f]{64}$/u);
  assert.equal(evidence.storageObjectBytesExact, true);
  assert.equal(JSON.stringify(evidence).includes("public.profiles"), false);
  assert.equal(JSON.stringify(evidence).includes('"2"'), false);
  assert.equal(JSON.stringify(evidence).includes(Buffer.alloc(32, 7).toString("hex")), false);
});

test("body-free verification rejects count drift, security failure and missing Storage bytes", () => {
  assert.throws(() =>
    createHostedRestoreVerification({
      ...base,
      hmacKey: Buffer.alloc(32, 7),
      targetCounts: { ...base.targetCounts, "public.profiles": 1 },
    }),
  );
  assert.throws(() =>
    createHostedRestoreVerification({
      ...base,
      hmacKey: Buffer.alloc(32, 7),
      securityVerdict: { ...base.securityVerdict, crossTenantDenied: false },
    }),
  );
  assert.throws(() =>
    createHostedRestoreVerification({
      ...base,
      hmacKey: Buffer.alloc(32, 7),
      sourceAttestation: {
        sourceCandidateCommit: commit,
        storageExportManifestSha256: "c".repeat(64),
        storageObjectBytesMode: "separate-encrypted-export",
      },
      storageVerdict: {
        databaseMetadataExact: true,
        restoredObjectCount: 1,
        separateExportBytesExact: false,
        separateExportManifestSha256: "c".repeat(64),
        sourceObjectCount: 1,
      },
    }),
  );
});

test("body-free verification accepts only an exact separately encrypted Storage export", () => {
  const exportDigest = "d".repeat(64);
  const evidence = createHostedRestoreVerification({
    ...base,
    hmacKey: Buffer.alloc(32, 9),
    sourceAttestation: {
      sourceCandidateCommit: commit,
      storageExportManifestSha256: exportDigest,
      storageObjectBytesMode: "separate-encrypted-export",
    },
    storageVerdict: {
      databaseMetadataExact: true,
      restoredObjectCount: 2,
      separateExportBytesExact: true,
      separateExportManifestSha256: exportDigest,
      sourceObjectCount: 2,
    },
  });
  assert.equal(evidence.storageMetadataExact, true);
  assert.equal(evidence.storageObjectBytesExact, true);
  assert.equal(JSON.stringify(evidence).includes(exportDigest), false);
});
