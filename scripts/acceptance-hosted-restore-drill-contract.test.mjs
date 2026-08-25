import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalHostedRestoreDocumentSha256,
  deriveHostedRestoreDrillLifecycle,
  renderHostedRestoreDrillPlan,
  validateHostedRestoreDrillEvidence,
} from "./acceptance-hosted-restore-drill-contract.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const digest = "a".repeat(64);
const drillId = "seen-said-recovery-2026-q3-0123456789abcdef";

function sourceAttestation() {
  return {
    contract: "huayi-hosted-restore-source-attestation/v1",
    coverageProfile: "reviewed-production-coverage/v1",
    coverageReportSha256: digest,
    drillId,
    dumpBytes: 1024,
    dumpFile: "database.dump",
    dumpFormat: "postgres-custom",
    dumpMode: "0600",
    dumpSha256: digest,
    manifestSha256: digest,
    migrationHead: "20260824010000",
    retentionDeadline: "2026-11-25T00:00:00.000Z",
    retentionPolicyVersion: "production-backup-retention/v1",
    sourceCandidateCommit: commit,
    sourceCapturedAt: "2026-08-25T00:00:00.000Z",
    sourceEnvironment: "production",
    sourceProjectIdentityDigest: digest,
    storageExportManifestSha256: null,
    storageObjectBytesMode: "source-empty",
    tocAllowlistSha256: digest,
    toolCandidateCommit: commit,
  };
}

function approvedPlan() {
  const source = sourceAttestation();
  return {
    approvalReference: "approval.phase87.test",
    approvedAt: "2026-08-25T00:30:00.000Z",
    contract: "huayi-hosted-restore-approved-plan/v1",
    coverageProfile: source.coverageProfile,
    coverageReportSha256: source.coverageReportSha256,
    drillId,
    dumpBytes: source.dumpBytes,
    dumpSha256: source.dumpSha256,
    manifestSha256: source.manifestSha256,
    migrationHead: source.migrationHead,
    postgresMajor: "17",
    retentionDeadline: source.retentionDeadline,
    retentionPolicyVersion: source.retentionPolicyVersion,
    sourceCandidateCommit: source.sourceCandidateCommit,
    sourceCapturedAt: source.sourceCapturedAt,
    sourceProjectIdentityDigest: source.sourceProjectIdentityDigest,
    storageExportManifestSha256: source.storageExportManifestSha256,
    storageObjectBytesMode: source.storageObjectBytesMode,
    targetRegion: "ap-southeast-1",
    tocAllowlistSha256: source.tocAllowlistSha256,
    toolCandidateCommit: commit,
  };
}

function targetEmpty(source) {
  return {
    authRowsEmpty: true,
    contract: "huayi-hosted-restore-target-empty/v1",
    drillId,
    outboundIntegrationsAbsent: true,
    platformBaselineExact: true,
    postgresMajor: "17",
    productSchemasAbsent: true,
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    storageRowsEmpty: true,
    targetCreatedAt: "2026-08-25T01:00:00.000Z",
    targetEmptyVerifiedAt: "2026-08-25T01:01:00.000Z",
    targetIdentityDigest: "b".repeat(64),
    targetRegion: "ap-southeast-1",
    toolCandidateCommit: commit,
  };
}

function restoreVerification(source, target) {
  return {
    adminProjectionExact: true,
    applicationRoleAccessExact: true,
    authRelationalContractExact: true,
    completedAt: "2026-08-25T02:00:00.000Z",
    contract: "huayi-hosted-restore-verification/v1",
    countDigestAlgorithm: "hmac-sha256-v1",
    crossTenantDenied: true,
    drillId,
    migrationHeadExact: true,
    ownerContextIsolationExact: true,
    platformConfigUntouched: true,
    platformRolesUntouched: true,
    platformRuntimeExact: true,
    productSchemaExact: true,
    rlsForcedExact: true,
    sourceAttestationSha256: target.sourceAttestationSha256,
    sourceCandidateCommit: commit,
    sourceCountDigest: "c".repeat(64),
    sourceInspectionScratchDestroyedExact: true,
    storageMetadataExact: true,
    storageObjectBytesExact: true,
    targetCountDigest: "c".repeat(64),
    targetIdentityDigest: target.targetIdentityDigest,
    targetRoleGraphExact: true,
    toolCandidateCommit: commit,
    unknownTenantDenied: true,
  };
}

function cleanup(source, target) {
  return {
    cleanupCompletedAt: "2026-08-25T03:00:00.000Z",
    contract: "huayi-hosted-restore-target-cleanup/v1",
    drillId,
    outboundArtifactsAbsent: true,
    sourceAttestationSha256: target.sourceAttestationSha256,
    sourceCandidateCommit: commit,
    targetAbsenceVerified: true,
    targetCredentialsRevoked: true,
    targetDeletionRequested: true,
    targetIdentityDigest: target.targetIdentityDigest,
    temporaryArtifactsRemoved: true,
    toolCandidateCommit: commit,
  };
}

function retention(source, target) {
  return {
    contract: "huayi-hosted-restore-source-retention/v1",
    drillId,
    retentionDeadline: source.retentionDeadline,
    retentionVerifiedAt: "2026-08-25T03:01:00.000Z",
    sourceArchiveRetained: true,
    sourceAttestationSha256: target.sourceAttestationSha256,
    sourceCandidateCommit: commit,
    toolCandidateCommit: commit,
  };
}

function failure(source, target, overrides = {}) {
  return {
    contract: "huayi-hosted-restore-failure/v1",
    drillId,
    failedAt: "2026-08-25T02:30:00.000Z",
    failedStage: "target-delete",
    failureClass: "cleanup",
    sourceAttestationSha256: target.sourceAttestationSha256,
    sourceCandidateCommit: commit,
    targetIdentityDigest: target.targetIdentityDigest,
    toolCandidateCommit: commit,
    ...overrides,
  };
}

test("restore drill exposes a zero-I/O plan and derives strict initial lifecycle", () => {
  assert.match(renderHostedRestoreDrillPlan(), /zero filesystem \/ zero Git \/ zero network/u);
  assert.equal(deriveHostedRestoreDrillLifecycle({}), "planned");
  assert.equal(
    deriveHostedRestoreDrillLifecycle({ sourceAttestation: sourceAttestation() }),
    "source-bound",
  );
});

test("restore drill evidence rejects extra keys and success/failure coexistence", () => {
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: { sourceAttestation: { ...sourceAttestation(), leaked: "value" } },
      expected: approvedPlan(),
    }),
  );
  assert.throws(() =>
    deriveHostedRestoreDrillLifecycle({
      failureVerification: {},
      restoreVerification: {},
      sourceAttestation: sourceAttestation(),
    }),
  );
});

test("restore drill derives target-destroyed before retention-pending on both routes", () => {
  const source = sourceAttestation();
  const target = targetEmpty(source);
  const restore = restoreVerification(source, target);
  const cleanupDocument = cleanup(source, target);
  assert.equal(
    deriveHostedRestoreDrillLifecycle({
      cleanupVerification: cleanupDocument,
      restoreVerification: restore,
      sourceAttestation: source,
      targetEmptyVerification: target,
    }),
    "target-destroyed",
  );
  assert.equal(
    deriveHostedRestoreDrillLifecycle({
      cleanupVerification: cleanupDocument,
      restoreVerification: restore,
      sourceAttestation: source,
      sourceRetentionVerification: retention(source, target),
      targetEmptyVerification: target,
    }),
    "retention-pending",
  );
  assert.equal(
    deriveHostedRestoreDrillLifecycle({
      cleanupVerification: cleanupDocument,
      failureVerification: failure(source, target, {
        failedAt: "2026-08-25T01:30:00.000Z",
        failedStage: "data",
        failureClass: "contract",
      }),
      sourceAttestation: source,
      targetEmptyVerification: target,
    }),
    "failed-target-destroyed",
  );
});

test("post-restore failure exception is limited to cleanup or retention-close with strict time", () => {
  const source = sourceAttestation();
  const target = targetEmpty(source);
  const restore = restoreVerification(source, target);
  const documents = {
    failureVerification: failure(source, target),
    restoreVerification: restore,
    sourceAttestation: source,
    targetEmptyVerification: target,
  };
  assert.equal(deriveHostedRestoreDrillLifecycle(documents), "failed-cleanup-pending");
  assert.equal(
    validateHostedRestoreDrillEvidence({ documents, expected: approvedPlan() }),
    "failed-cleanup-pending",
  );
  for (const overrides of [
    { failedStage: "data" },
    { failedAt: restore.completedAt },
    { targetIdentityDigest: "d".repeat(64) },
  ]) {
    assert.throws(() =>
      validateHostedRestoreDrillEvidence({
        documents: {
          ...documents,
          failureVerification: failure(source, target, overrides),
        },
        expected: approvedPlan(),
      }),
    );
  }
});

test("failure stages require the exact target evidence boundary", () => {
  const source = sourceAttestation();
  const target = targetEmpty(source);
  for (const [targetDocument, failedStage] of [
    [undefined, "data"],
    [target, "target-create"],
    [target, "target-empty"],
    [target, "target-delete"],
    [target, "retention-close"],
  ]) {
    assert.throws(() =>
      validateHostedRestoreDrillEvidence({
        documents: {
          failureVerification: failure(source, target, {
            failedStage,
            targetIdentityDigest:
              failedStage === "target-create" && targetDocument === undefined
                ? null
                : target.targetIdentityDigest,
          }),
          sourceAttestation: source,
          ...(targetDocument === undefined ? {} : { targetEmptyVerification: targetDocument }),
        },
        expected: approvedPlan(),
      }),
    );
  }
});

test("strict evidence timestamps follow target restore failure cleanup retention disposition order", () => {
  const source = sourceAttestation();
  const target = targetEmpty(source);
  const restore = restoreVerification(source, target);
  const cleanupDocument = cleanup(source, target);
  const retentionDocument = retention(source, target);
  const baseDocuments = {
    cleanupVerification: cleanupDocument,
    restoreVerification: restore,
    sourceAttestation: source,
    sourceRetentionVerification: retentionDocument,
    targetEmptyVerification: target,
  };
  assert.equal(
    validateHostedRestoreDrillEvidence({
      documents: baseDocuments,
      expected: approvedPlan(),
    }),
    "retention-pending",
  );
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: {
        ...baseDocuments,
        restoreVerification: { ...restore, completedAt: target.targetEmptyVerifiedAt },
      },
      expected: approvedPlan(),
    }),
  );
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: {
        ...baseDocuments,
        cleanupVerification: { ...cleanupDocument, cleanupCompletedAt: restore.completedAt },
      },
      expected: approvedPlan(),
    }),
  );
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: {
        ...baseDocuments,
        sourceRetentionVerification: {
          ...retentionDocument,
          retentionVerifiedAt: cleanupDocument.cleanupCompletedAt,
        },
      },
      expected: approvedPlan(),
    }),
  );
});

test("direct deadline disposition still requires cleanup and strict time without retention evidence", () => {
  const source = sourceAttestation();
  const target = targetEmpty(source);
  const restore = restoreVerification(source, target);
  const cleanupDocument = cleanup(source, target);
  const dispositionDocument = {
    archiveDeletedAt: source.retentionDeadline,
    archiveDeletionVerified: true,
    contract: "huayi-hosted-restore-source-disposition/v1",
    drillId,
    manifestDeletionVerified: true,
    retentionDeadline: source.retentionDeadline,
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    storageExportDeletedOrNotApplicable: true,
    toolCandidateCommit: commit,
  };
  const documents = {
    cleanupVerification: cleanupDocument,
    restoreVerification: restore,
    sourceAttestation: source,
    sourceDisposition: dispositionDocument,
    targetEmptyVerification: target,
  };
  assert.equal(
    validateHostedRestoreDrillEvidence({ documents, expected: approvedPlan() }),
    "closed",
  );
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: { ...documents, cleanupVerification: undefined },
      expected: approvedPlan(),
    }),
  );
  assert.throws(() =>
    validateHostedRestoreDrillEvidence({
      documents: {
        ...documents,
        sourceDisposition: {
          ...dispositionDocument,
          archiveDeletedAt: "2026-11-24T23:59:59.999Z",
        },
      },
      expected: approvedPlan(),
    }),
  );
});
