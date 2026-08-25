import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createHostedRestoreDrillArtifactStore } from "./acceptance-hosted-restore-drill-artifacts.mjs";
import { canonicalHostedRestoreDocumentSha256 } from "./acceptance-hosted-restore-drill-contract.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const digest = "a".repeat(64);
const drillId = "seen-said-recovery-2026-q3-0123456789abcdef";
const expected = {
  approvalReference: "approval.phase87.test",
  approvedAt: "2026-08-25T00:30:00.000Z",
  contract: "huayi-hosted-restore-approved-plan/v1",
  coverageProfile: "reviewed-production-coverage/v1",
  coverageReportSha256: digest,
  drillId,
  dumpBytes: 1024,
  dumpSha256: digest,
  manifestSha256: digest,
  migrationHead: "20260824010000",
  postgresMajor: "17",
  retentionDeadline: "2026-11-25T00:00:00.000Z",
  retentionPolicyVersion: "production-backup-retention/v1",
  sourceCandidateCommit: commit,
  sourceCapturedAt: "2026-08-25T00:00:00.000Z",
  sourceProjectIdentityDigest: digest,
  storageExportManifestSha256: null,
  storageObjectBytesMode: "source-empty",
  targetRegion: "ap-southeast-1",
  tocAllowlistSha256: digest,
  toolCandidateCommit: commit,
};
const roots = [];

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "huayi-hosted-restore-artifacts-"));
  roots.push(root);
  return root;
}

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
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
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
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    targetAbsenceVerified: true,
    targetCredentialsRevoked: true,
    targetDeletionRequested: true,
    targetIdentityDigest: target.targetIdentityDigest,
    temporaryArtifactsRemoved: true,
    toolCandidateCommit: commit,
  };
}

function disposition(source, overrides = {}) {
  return {
    archiveDeletedAt: "2026-11-25T00:00:00.000Z",
    archiveDeletionVerified: true,
    contract: "huayi-hosted-restore-source-disposition/v1",
    drillId,
    manifestDeletionVerified: true,
    retentionDeadline: source.retentionDeadline,
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    storageExportDeletedOrNotApplicable: true,
    toolCandidateCommit: commit,
    ...overrides,
  };
}

function retention(source, overrides = {}) {
  return {
    contract: "huayi-hosted-restore-source-retention/v1",
    drillId,
    retentionDeadline: source.retentionDeadline,
    retentionVerifiedAt: "2026-08-25T03:01:00.000Z",
    sourceArchiveRetained: true,
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    toolCandidateCommit: commit,
    ...overrides,
  };
}

function failure(source, target, overrides = {}) {
  return {
    contract: "huayi-hosted-restore-failure/v1",
    drillId,
    failedAt: "2026-08-25T02:00:00.000Z",
    failedStage: "data",
    failureClass: "contract",
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: commit,
    targetIdentityDigest: target.targetIdentityDigest,
    toolCandidateCommit: commit,
    ...overrides,
  };
}

test("artifact store commits canonical private evidence in strict lifecycle order", async () => {
  const root = await temporaryRepository();
  const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
  const source = sourceAttestation();
  const target = targetEmpty(source);

  assert.deepEqual(await store.read(), { documents: {}, lifecycle: "planned" });
  await store.append("sourceAttestation", source);
  await store.append("targetEmptyVerification", target);
  await store.append("restoreVerification", restoreVerification(source, target));
  await store.append("cleanupVerification", cleanup(source, target));
  assert.equal((await store.read()).lifecycle, "target-destroyed");
  await store.append("sourceRetentionVerification", retention(source));
  assert.equal((await store.read()).lifecycle, "retention-pending");
  await store.append("sourceDisposition", disposition(source));

  const result = await store.read();
  assert.equal(result.lifecycle, "closed");
  const drillRoot = join(root, "artifacts", "hosted-restore-drills", drillId);
  assert.deepEqual((await readdir(drillRoot)).sort(), [
    "restore-verification.json",
    "source-attestation.json",
    "source-disposition.json",
    "source-retention-verification.json",
    "target-cleanup-verification.json",
    "target-empty-verification.json",
  ]);
  for (const name of await readdir(drillRoot)) {
    const path = join(drillRoot, name);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    const sourceText = await readFile(path, "utf8");
    assert.equal(sourceText, `${JSON.stringify(JSON.parse(sourceText))}\n`);
  }
  assert.equal((await lstat(drillRoot)).mode & 0o777, 0o700);
});

test("artifact store rejects skipped stages, overwrite, partial, symlink and unsafe modes", async () => {
  for (const variant of ["skip", "overwrite", "partial", "symlink", "mode"]) {
    const root = await temporaryRepository();
    const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
    const source = sourceAttestation();
    if (variant === "skip") {
      await assert.rejects(store.append("targetEmptyVerification", targetEmpty(source)));
      continue;
    }
    await store.append("sourceAttestation", source);
    const drillRoot = join(root, "artifacts", "hosted-restore-drills", drillId);
    if (variant === "overwrite") {
      await assert.rejects(store.append("sourceAttestation", source));
    } else if (variant === "partial") {
      await symlink("source-attestation.json", join(drillRoot, "leaked.partial"));
      await assert.rejects(store.read());
    } else if (variant === "symlink") {
      const path = join(drillRoot, "source-attestation.json");
      await rm(path);
      await symlink("outside", path);
      await assert.rejects(store.read());
    } else {
      await chmod(join(drillRoot, "source-attestation.json"), 0o644);
      await assert.rejects(store.read());
    }
  }
});

test("artifact store derives the failed-cleanup-retention lifecycle without claiming success", async () => {
  const root = await temporaryRepository();
  const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
  const source = sourceAttestation();
  const target = targetEmpty(source);
  await store.append("sourceAttestation", source);
  await store.append("targetEmptyVerification", target);
  await store.append("failureVerification", failure(source, target));
  assert.equal((await store.read()).lifecycle, "failed-cleanup-pending");
  await store.append("cleanupVerification", cleanup(source, target));
  assert.equal((await store.read()).lifecycle, "failed-target-destroyed");
  await store.append("sourceRetentionVerification", retention(source));
  assert.equal((await store.read()).lifecycle, "failed-cleaned-retention-pending");
  await store.append("sourceDisposition", disposition(source));
  const result = await store.read();
  assert.equal(result.lifecycle, "failed-closed");
  assert.equal(result.documents.restoreVerification, undefined);
});

test("artifact store permits only the post-restore target-delete failure exception", async () => {
  const root = await temporaryRepository();
  const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
  const source = sourceAttestation();
  const target = targetEmpty(source);
  await store.append("sourceAttestation", source);
  await store.append("targetEmptyVerification", target);
  await store.append("restoreVerification", restoreVerification(source, target));
  await store.append(
    "failureVerification",
    failure(source, target, {
      failedAt: "2026-08-25T02:30:00.000Z",
      failedStage: "target-delete",
      failureClass: "cleanup",
    }),
  );
  assert.equal((await store.read()).lifecycle, "failed-cleanup-pending");
  await store.append("cleanupVerification", cleanup(source, target));
  assert.equal((await store.read()).lifecycle, "failed-target-destroyed");
  await store.append("sourceRetentionVerification", retention(source));
  assert.equal((await store.read()).lifecycle, "failed-cleaned-retention-pending");
  await store.append("sourceDisposition", disposition(source));
  assert.equal((await store.read()).lifecycle, "failed-closed");
});

test("retention-close failure after cleanup preserves archive until deadline disposition", async () => {
  const root = await temporaryRepository();
  const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
  const source = sourceAttestation();
  const target = targetEmpty(source);
  await store.append("sourceAttestation", source);
  await store.append("targetEmptyVerification", target);
  await store.append("restoreVerification", restoreVerification(source, target));
  await store.append("cleanupVerification", cleanup(source, target));
  await store.append(
    "failureVerification",
    failure(source, target, {
      failedAt: "2026-08-25T04:00:00.000Z",
      failedStage: "retention-close",
      failureClass: "contract",
    }),
  );
  assert.equal((await store.read()).lifecycle, "failed-cleaned-retention-pending");
  await assert.rejects(
    store.append(
      "sourceDisposition",
      disposition(source, { archiveDeletedAt: "2026-11-24T23:59:59.999Z" }),
    ),
  );
  await store.append("sourceDisposition", disposition(source));
  assert.equal((await store.read()).lifecycle, "failed-closed");
});

test("deadline close can move target-destroyed directly to closed on both routes", async () => {
  for (const failed of [false, true]) {
    const root = await temporaryRepository();
    const store = createHostedRestoreDrillArtifactStore({ expected, repositoryRoot: root });
    const source = sourceAttestation();
    const target = targetEmpty(source);
    await store.append("sourceAttestation", source);
    await store.append("targetEmptyVerification", target);
    if (failed) {
      await store.append("failureVerification", failure(source, target));
    } else {
      await store.append("restoreVerification", restoreVerification(source, target));
    }
    await store.append("cleanupVerification", cleanup(source, target));
    assert.equal(
      (await store.read()).lifecycle,
      failed ? "failed-target-destroyed" : "target-destroyed",
    );
    await assert.rejects(
      store.append(
        "sourceDisposition",
        disposition(source, { archiveDeletedAt: "2026-11-24T23:59:59.999Z" }),
      ),
    );
    await store.append("sourceDisposition", disposition(source));
    assert.equal((await store.read()).lifecycle, failed ? "failed-closed" : "closed");
  }
});
