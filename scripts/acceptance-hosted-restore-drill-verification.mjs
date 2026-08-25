import { createHmac } from "node:crypto";

const commitPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const drillIdPattern = /^seen-said-recovery-\d{4}-q[1-4]-[0-9a-f]{16}$/u;
const countKeyPattern =
  /^(?:auth|huayi_private|public|storage|supabase_migrations)\.[a-z_][a-z0-9_$.-]{0,127}$/u;
const securityKeys = Object.freeze([
  "adminProjectionExact",
  "applicationRoleAccessExact",
  "authRelationalContractExact",
  "crossTenantDenied",
  "migrationHeadExact",
  "ownerContextIsolationExact",
  "platformConfigUntouched",
  "platformRolesUntouched",
  "platformRuntimeExact",
  "productSchemaExact",
  "rlsForcedExact",
  "sourceInspectionScratchDestroyedExact",
  "targetRoleGraphExact",
  "unknownTenantDenied",
]);
const storageKeys = Object.freeze([
  "databaseMetadataExact",
  "restoredObjectCount",
  "separateExportBytesExact",
  "separateExportManifestSha256",
  "sourceObjectCount",
]);

function fail() {
  throw new Error("Hosted restore-drill body-free verification failed.");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function countDigest(counts, key) {
  if (!isRecord(counts)) fail();
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length === 0 ||
    entries.length > 10_000 ||
    entries.some(
      ([name, count]) =>
        !countKeyPattern.test(name) ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > Number.MAX_SAFE_INTEGER,
    )
  ) {
    fail();
  }
  return createHmac("sha256", key)
    .update(`${JSON.stringify(entries)}\n`)
    .digest("hex");
}

function validateStorage(sourceAttestation, storageVerdict) {
  if (
    !hasExactKeys(storageVerdict, storageKeys) ||
    storageVerdict.databaseMetadataExact !== true ||
    !Number.isSafeInteger(storageVerdict.sourceObjectCount) ||
    storageVerdict.sourceObjectCount < 0 ||
    !Number.isSafeInteger(storageVerdict.restoredObjectCount) ||
    storageVerdict.restoredObjectCount !== storageVerdict.sourceObjectCount
  ) {
    fail();
  }
  if (sourceAttestation.storageObjectBytesMode === "source-empty") {
    if (
      sourceAttestation.storageExportManifestSha256 !== null ||
      storageVerdict.sourceObjectCount !== 0 ||
      storageVerdict.separateExportBytesExact !== false ||
      storageVerdict.separateExportManifestSha256 !== null
    ) {
      fail();
    }
  } else if (sourceAttestation.storageObjectBytesMode === "separate-encrypted-export") {
    if (
      storageVerdict.sourceObjectCount < 1 ||
      storageVerdict.separateExportBytesExact !== true ||
      !digestPattern.test(sourceAttestation.storageExportManifestSha256) ||
      storageVerdict.separateExportManifestSha256 !== sourceAttestation.storageExportManifestSha256
    ) {
      fail();
    }
  } else {
    fail();
  }
}

export function createHostedRestoreVerification({
  drillId,
  hmacKey,
  now = () => new Date(),
  securityVerdict,
  sourceAttestation,
  sourceAttestationSha256,
  sourceCounts,
  storageVerdict,
  targetCounts,
  targetIdentityDigest,
  toolCandidateCommit,
}) {
  if (
    !drillIdPattern.test(drillId) ||
    !Buffer.isBuffer(hmacKey) ||
    hmacKey.byteLength !== 32 ||
    !isRecord(sourceAttestation) ||
    !commitPattern.test(sourceAttestation.sourceCandidateCommit) ||
    !digestPattern.test(sourceAttestationSha256) ||
    !digestPattern.test(targetIdentityDigest) ||
    !commitPattern.test(toolCandidateCommit) ||
    !hasExactKeys(securityVerdict, securityKeys) ||
    securityKeys.some((key) => securityVerdict[key] !== true)
  ) {
    fail();
  }
  validateStorage(sourceAttestation, storageVerdict);
  const sourceCountDigest = countDigest(sourceCounts, hmacKey);
  const targetCountDigest = countDigest(targetCounts, hmacKey);
  if (sourceCountDigest !== targetCountDigest) fail();
  const completedAt = now().toISOString();
  if (new Date(completedAt).toISOString() !== completedAt) fail();
  return {
    adminProjectionExact: true,
    applicationRoleAccessExact: true,
    authRelationalContractExact: true,
    completedAt,
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
    sourceAttestationSha256,
    sourceCandidateCommit: sourceAttestation.sourceCandidateCommit,
    sourceCountDigest,
    sourceInspectionScratchDestroyedExact: true,
    storageMetadataExact: true,
    storageObjectBytesExact: true,
    targetCountDigest,
    targetIdentityDigest,
    targetRoleGraphExact: true,
    toolCandidateCommit,
    unknownTenantDenied: true,
  };
}
