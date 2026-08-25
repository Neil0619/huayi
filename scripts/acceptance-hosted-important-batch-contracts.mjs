const migrationVersionsThrough0014 = Object.freeze([
  "20260821000000",
  "20260821010000",
  "20260821020000",
  "20260821030000",
  "20260821040000",
  "20260821050000",
  "20260821060000",
  "20260821070000",
  "20260821080000",
  "20260822010000",
  "20260822020000",
  "20260822030000",
  "20260823010000",
  "20260824010000",
]);
const migrationFilesThrough0014 = Object.freeze([
  "20260821000000_cloud_v1_foundation.sql",
  "20260821010000_account_default_quota.sql",
  "20260821020000_password_auth_callback_method.sql",
  "20260821030000_analysis_reservation_fallback.sql",
  "20260821040000_practice_generation_settlement.sql",
  "20260821050000_owner_scoped_analysis_export.sql",
  "20260821060000_analysis_export_owner_wrapper.sql",
  "20260821070000_extension_pairing_atomic_snapshot.sql",
  "20260821080000_account_deletion_replay.sql",
  "20260822010000_quota_lifecycle_and_model_rate_limit.sql",
  "20260822020000_security_notification_delivery.sql",
  "20260822030000_first_operator_bootstrap.sql",
  "20260823010000_password_signup_interruption_recovery.sql",
  "20260824010000_password_signup_otp_resend.sql",
]);

export const hostedPhase81ArtifactContract = Object.freeze({
  artifactDirectory: "artifacts/hosted-important-batch-backups/phase-81-0014",
  batchId: "phase-81-0014",
  captureIdentityPrefix: "phase-81-0014",
  migrationFiles: migrationFilesThrough0014,
  migrationVersions: migrationVersionsThrough0014,
  platformBaselineIdentityPrefix: "phase-81-0014",
  postMigrationHead: "20260824010000",
  preMigrationHead: "20260823010000",
  rebuildMigrationHead: "20260824010000",
  scratchContainer: "huayi-phase-81-0014-rebuild",
  scratchLabel: "phase-81-0014-rebuild",
});

export const hostedPhase91ArtifactContract = Object.freeze({
  artifactDirectory:
    "artifacts/hosted-important-batch-backups/phase-91-0015-public-function-acl-hardening",
  batchId: "phase-91-0015-public-function-acl-hardening",
  captureIdentityPrefix: "phase-91-0015-acl",
  migrationFiles: Object.freeze([
    ...migrationFilesThrough0014,
    "20260825010000_public_function_acl_hardening.sql",
  ]),
  migrationVersions: Object.freeze([...migrationVersionsThrough0014, "20260825010000"]),
  platformBaselineIdentityPrefix: "phase-91-0015-acl",
  postMigrationHead: "20260825010000",
  preMigrationHead: "20260824010000",
  rebuildMigrationHead: "20260825010000",
  scratchContainer: "huayi-phase-91-0015-acl-rebuild",
  scratchLabel: "phase-91-0015-acl-rebuild",
});

const artifactContracts = new Set([hostedPhase81ArtifactContract, hostedPhase91ArtifactContract]);

export function assertHostedImportantBatchArtifactContract(contract) {
  if (!artifactContracts.has(contract)) {
    throw new Error("Hosted important-batch artifact contract is invalid.");
  }
}
