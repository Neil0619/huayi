import { createHash } from "node:crypto";

import { validateHostedRestoreApprovedPlan } from "./acceptance-hosted-restore-drill-approved-plan.mjs";
import {
  hostedRestoreCommitPattern as commitPattern,
  hostedRestoreDigestPattern as digestPattern,
  hostedRestoreDrillIdPattern as drillIdPattern,
  hostedRestoreEvidenceDefinitions as definitions,
  hostedRestoreFailureClasses,
  hostedRestoreFailureStages,
  hostedRestoreIsoPattern as isoPattern,
} from "./acceptance-hosted-restore-drill-schema.mjs";

export {
  hostedRestoreDrillArtifactRoot,
  hostedRestoreDrillConfirmation,
  hostedRestoreDrillStages,
  hostedRestoreFailureClasses,
  hostedRestoreFailureStages,
} from "./acceptance-hosted-restore-drill-schema.mjs";
export { validateHostedRestoreApprovedPlan } from "./acceptance-hosted-restore-drill-approved-plan.mjs";

function fail() {
  throw new Error("Hosted restore-drill contract failed.");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(document, expectedKeys) {
  if (!isRecord(document)) fail();
  const actual = Object.keys(document).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail();
  }
}

function assertIso(value) {
  if (
    typeof value !== "string" ||
    !isoPattern.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    fail();
  }
}

function assertCommon(document, expected, source) {
  if (
    document.drillId !== expected.drillId ||
    !drillIdPattern.test(document.drillId) ||
    document.toolCandidateCommit !== expected.toolCandidateCommit ||
    !commitPattern.test(document.toolCandidateCommit)
  ) {
    fail();
  }
  if (
    source !== undefined &&
    (document.sourceCandidateCommit !== source.sourceCandidateCommit ||
      document.sourceAttestationSha256 !== canonicalHostedRestoreDocumentSha256(source))
  ) {
    fail();
  }
}

function validateSource(document, expected) {
  assertCommon(document, expected);
  assertIso(document.sourceCapturedAt);
  assertIso(document.retentionDeadline);
  if (
    document.sourceEnvironment !== "production" ||
    document.dumpFile !== "database.dump" ||
    document.dumpFormat !== "postgres-custom" ||
    document.dumpMode !== "0600" ||
    !Number.isSafeInteger(document.dumpBytes) ||
    document.dumpBytes < 1 ||
    !commitPattern.test(document.sourceCandidateCommit) ||
    !/^\d{14}$/u.test(document.migrationHead) ||
    !digestPattern.test(document.coverageReportSha256) ||
    !digestPattern.test(document.dumpSha256) ||
    !digestPattern.test(document.manifestSha256) ||
    !digestPattern.test(document.sourceProjectIdentityDigest) ||
    !digestPattern.test(document.tocAllowlistSha256) ||
    typeof document.coverageProfile !== "string" ||
    document.coverageProfile.length < 1 ||
    document.coverageProfile.length > 128 ||
    typeof document.retentionPolicyVersion !== "string" ||
    document.retentionPolicyVersion.length < 1 ||
    document.retentionPolicyVersion.length > 128 ||
    new Date(document.retentionDeadline) <= new Date(document.sourceCapturedAt)
  ) {
    fail();
  }
  for (const key of [
    "coverageProfile",
    "coverageReportSha256",
    "dumpBytes",
    "dumpSha256",
    "manifestSha256",
    "migrationHead",
    "retentionDeadline",
    "retentionPolicyVersion",
    "sourceCandidateCommit",
    "sourceCapturedAt",
    "sourceProjectIdentityDigest",
    "storageExportManifestSha256",
    "storageObjectBytesMode",
    "tocAllowlistSha256",
  ]) {
    if (document[key] !== expected[key]) fail();
  }
  const sourceEmpty = document.storageObjectBytesMode === "source-empty";
  const separate = document.storageObjectBytesMode === "separate-encrypted-export";
  if (
    (!sourceEmpty && !separate) ||
    (sourceEmpty && document.storageExportManifestSha256 !== null) ||
    (separate && !digestPattern.test(document.storageExportManifestSha256))
  ) {
    fail();
  }
}

function validateTargetEmpty(document, expected, source) {
  assertCommon(document, expected, source);
  assertIso(document.targetCreatedAt);
  assertIso(document.targetEmptyVerifiedAt);
  if (
    !digestPattern.test(document.targetIdentityDigest) ||
    document.postgresMajor !== expected.postgresMajor ||
    document.targetRegion !== expected.targetRegion ||
    new Date(document.targetEmptyVerifiedAt) < new Date(document.targetCreatedAt) ||
    new Date(document.targetCreatedAt) <= new Date(expected.approvedAt) ||
    [
      "authRowsEmpty",
      "outboundIntegrationsAbsent",
      "platformBaselineExact",
      "productSchemasAbsent",
      "storageRowsEmpty",
    ].some((key) => document[key] !== true)
  ) {
    fail();
  }
}

function validateRestore(document, expected, source, target) {
  assertCommon(document, expected, source);
  assertIso(document.completedAt);
  if (
    target === undefined ||
    document.targetIdentityDigest !== target.targetIdentityDigest ||
    new Date(document.completedAt) <= new Date(target.targetEmptyVerifiedAt) ||
    document.countDigestAlgorithm !== "hmac-sha256-v1" ||
    !digestPattern.test(document.sourceCountDigest) ||
    document.sourceCountDigest !== document.targetCountDigest
  ) {
    fail();
  }
  const booleans = definitions.restoreVerification.keys.filter(
    (key) => /(?:Exact|Denied|Untouched)$/u.test(key) && key !== "targetIdentityDigest",
  );
  if (booleans.some((key) => document[key] !== true)) fail();
}

function validateFailure(document, expected, source, target, restore, cleanup) {
  assertCommon(document, expected, source);
  assertIso(document.failedAt);
  if (
    !hostedRestoreFailureStages.includes(document.failedStage) ||
    !hostedRestoreFailureClasses.includes(document.failureClass) ||
    new Date(document.failedAt) <= new Date(expected.approvedAt) ||
    (document.targetIdentityDigest === null && document.failedStage !== "target-create") ||
    (document.targetIdentityDigest !== null && !digestPattern.test(document.targetIdentityDigest))
  ) {
    fail();
  }
  const beforeTargetEmpty = ["target-create", "target-empty"].includes(document.failedStage);
  const afterRestore = ["target-delete", "retention-close"].includes(document.failedStage);
  if (
    (beforeTargetEmpty && target !== undefined) ||
    (!beforeTargetEmpty && !afterRestore && target === undefined) ||
    (afterRestore && restore === undefined)
  ) {
    fail();
  }
  if (
    target !== undefined &&
    (document.targetIdentityDigest !== target.targetIdentityDigest ||
      new Date(document.failedAt) <= new Date(target.targetEmptyVerifiedAt))
  ) {
    fail();
  }
  if (restore !== undefined) {
    if (
      !["target-delete", "retention-close"].includes(document.failedStage) ||
      new Date(document.failedAt) <= new Date(restore.completedAt)
    ) {
      fail();
    }
  }
  if (
    cleanup !== undefined &&
    document.failedStage === "retention-close" &&
    new Date(document.failedAt) <= new Date(cleanup.cleanupCompletedAt)
  ) {
    fail();
  }
}

function validateCleanup(document, expected, source, targetIdentityDigest, restore, failure) {
  assertCommon(document, expected, source);
  assertIso(document.cleanupCompletedAt);
  if (
    document.targetIdentityDigest !== targetIdentityDigest ||
    (restore !== undefined &&
      new Date(document.cleanupCompletedAt) <= new Date(restore.completedAt)) ||
    (failure !== undefined &&
      failure.failedStage !== "retention-close" &&
      new Date(document.cleanupCompletedAt) <= new Date(failure.failedAt)) ||
    [
      "outboundArtifactsAbsent",
      "targetAbsenceVerified",
      "targetCredentialsRevoked",
      "targetDeletionRequested",
      "temporaryArtifactsRemoved",
    ].some((key) => document[key] !== true)
  ) {
    fail();
  }
}

function validateRetention(document, expected, source, cleanup) {
  assertCommon(document, expected, source);
  assertIso(document.retentionVerifiedAt);
  if (
    cleanup === undefined ||
    document.retentionDeadline !== source.retentionDeadline ||
    document.sourceArchiveRetained !== true ||
    new Date(document.retentionVerifiedAt) <= new Date(cleanup.cleanupCompletedAt) ||
    new Date(document.retentionVerifiedAt) >= new Date(document.retentionDeadline)
  ) {
    fail();
  }
}

function validateDisposition(document, expected, source, cleanup, retention, failure) {
  assertCommon(document, expected, source);
  assertIso(document.archiveDeletedAt);
  if (
    cleanup === undefined ||
    document.retentionDeadline !== source.retentionDeadline ||
    new Date(document.archiveDeletedAt) < new Date(document.retentionDeadline) ||
    new Date(document.archiveDeletedAt) <= new Date(cleanup.cleanupCompletedAt) ||
    (retention !== undefined &&
      new Date(document.archiveDeletedAt) <= new Date(retention.retentionVerifiedAt)) ||
    (failure !== undefined && new Date(document.archiveDeletedAt) <= new Date(failure.failedAt)) ||
    [
      "archiveDeletionVerified",
      "manifestDeletionVerified",
      "storageExportDeletedOrNotApplicable",
    ].some((key) => document[key] !== true)
  ) {
    fail();
  }
}

export function canonicalHostedRestoreDocumentSha256(document) {
  return createHash("sha256")
    .update(`${JSON.stringify(document)}\n`)
    .digest("hex");
}

export function deriveHostedRestoreDrillLifecycle(documents) {
  if (!isRecord(documents)) fail();
  const present = (key) => documents[key] !== undefined;
  if (present("restoreVerification") && present("failureVerification")) {
    if (
      !["target-delete", "retention-close"].includes(documents.failureVerification?.failedStage)
    ) {
      fail();
    }
  }
  if (!present("sourceAttestation")) {
    if (Object.keys(documents).length !== 0) fail();
    return "planned";
  }
  if (present("restoreVerification") && !present("targetEmptyVerification")) fail();
  if (present("sourceRetentionVerification") && !present("cleanupVerification")) fail();
  if (present("sourceDisposition") && !present("cleanupVerification")) fail();
  if (
    documents.failureVerification?.failedStage === "retention-close" &&
    !present("cleanupVerification")
  ) {
    fail();
  }
  if (
    present("cleanupVerification") &&
    !present("restoreVerification") &&
    !present("failureVerification")
  ) {
    fail();
  }
  if (present("failureVerification")) {
    if (present("sourceDisposition")) return "failed-closed";
    if (
      present("sourceRetentionVerification") ||
      (documents.failureVerification?.failedStage === "retention-close" &&
        present("cleanupVerification"))
    ) {
      return "failed-cleaned-retention-pending";
    }
    if (present("cleanupVerification")) return "failed-target-destroyed";
    return "failed-cleanup-pending";
  }
  if (present("sourceDisposition")) return "closed";
  if (present("sourceRetentionVerification")) return "retention-pending";
  if (present("cleanupVerification")) return "target-destroyed";
  if (present("restoreVerification")) return "restored-verified";
  if (present("targetEmptyVerification")) return "target-empty";
  return "source-bound";
}

export function validateHostedRestoreDrillEvidence({ documents, expected }) {
  validateHostedRestoreApprovedPlan(expected);
  const lifecycle = deriveHostedRestoreDrillLifecycle(documents);
  for (const [name, document] of Object.entries(documents)) {
    const definition = definitions[name];
    if (definition === undefined) fail();
    assertExactKeys(document, definition.keys);
    if (document.contract !== definition.contract) fail();
  }
  const source = documents.sourceAttestation;
  if (source === undefined) return lifecycle;
  validateSource(source, expected);
  const target = documents.targetEmptyVerification;
  if (target !== undefined) validateTargetEmpty(target, expected, source);
  if (documents.restoreVerification !== undefined) {
    validateRestore(documents.restoreVerification, expected, source, target);
  }
  const restore = documents.restoreVerification;
  const failure = documents.failureVerification;
  const cleanup = documents.cleanupVerification;
  const retention = documents.sourceRetentionVerification;
  if (failure !== undefined) {
    validateFailure(failure, expected, source, target, restore, cleanup);
  }
  const identity = target?.targetIdentityDigest ?? failure?.targetIdentityDigest ?? null;
  if (cleanup !== undefined) {
    validateCleanup(cleanup, expected, source, identity, restore, failure);
  }
  if (retention !== undefined) {
    validateRetention(retention, expected, source, cleanup);
  }
  if (documents.sourceDisposition !== undefined) {
    validateDisposition(documents.sourceDisposition, expected, source, cleanup, retention, failure);
  }
  return lifecycle;
}

export function renderHostedRestoreDrillPlan() {
  return `Hosted production logical-backup restore drill control-plane plan (zero filesystem / zero Git / zero network / zero write)
- Production source identity, archive, coverage profile, retention deadline, region, PostgreSQL major, and recovery-project approval are intentionally not guessed.
- Real stages require one private drill plan, an exact candidate/source binding, the fixed confirmation, TTY-only secrets, pinned PostgreSQL 17 + CA, and a separately installed controlled stage adapter.
- The default CLI never creates a recovery project, reads an archive or secret, connects to Supabase, restores data, deploys, sends mail, or runs a Provider.
- Success requires strict source, target-empty, restore, cleanup, and retention-disposition evidence; a failed-cleaned drill never counts as passed.
`;
}
