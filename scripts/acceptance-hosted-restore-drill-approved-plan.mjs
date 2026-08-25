import {
  hostedRestoreCommitPattern as commitPattern,
  hostedRestoreDigestPattern as digestPattern,
  hostedRestoreDrillIdPattern as drillIdPattern,
  hostedRestoreIsoPattern as isoPattern,
} from "./acceptance-hosted-restore-drill-schema.mjs";

const approvedPlanKeys = Object.freeze([
  "approvalReference",
  "approvedAt",
  "contract",
  "coverageProfile",
  "coverageReportSha256",
  "drillId",
  "dumpBytes",
  "dumpSha256",
  "manifestSha256",
  "migrationHead",
  "postgresMajor",
  "retentionDeadline",
  "retentionPolicyVersion",
  "sourceCandidateCommit",
  "sourceCapturedAt",
  "sourceProjectIdentityDigest",
  "storageExportManifestSha256",
  "storageObjectBytesMode",
  "targetRegion",
  "tocAllowlistSha256",
  "toolCandidateCommit",
]);

function fail() {
  throw new Error("Hosted restore-drill approved-plan contract failed.");
}

function assertExactKeys(document) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) fail();
  const actual = Object.keys(document).sort();
  const expected = [...approvedPlanKeys].sort();
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

export function validateHostedRestoreApprovedPlan(expected) {
  assertExactKeys(expected);
  assertIso(expected.approvedAt);
  assertIso(expected.sourceCapturedAt);
  assertIso(expected.retentionDeadline);
  if (
    expected.contract !== "huayi-hosted-restore-approved-plan/v1" ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(expected.approvalReference) ||
    !drillIdPattern.test(expected.drillId) ||
    !commitPattern.test(expected.sourceCandidateCommit) ||
    !commitPattern.test(expected.toolCandidateCommit) ||
    expected.postgresMajor !== "17" ||
    !/^[a-z0-9-]{1,64}$/u.test(expected.targetRegion) ||
    !/^\d{14}$/u.test(expected.migrationHead) ||
    !Number.isSafeInteger(expected.dumpBytes) ||
    expected.dumpBytes < 1 ||
    !digestPattern.test(expected.coverageReportSha256) ||
    !digestPattern.test(expected.dumpSha256) ||
    !digestPattern.test(expected.manifestSha256) ||
    !digestPattern.test(expected.sourceProjectIdentityDigest) ||
    !digestPattern.test(expected.tocAllowlistSha256) ||
    typeof expected.coverageProfile !== "string" ||
    expected.coverageProfile.length < 1 ||
    expected.coverageProfile.length > 128 ||
    typeof expected.retentionPolicyVersion !== "string" ||
    expected.retentionPolicyVersion.length < 1 ||
    expected.retentionPolicyVersion.length > 128 ||
    new Date(expected.retentionDeadline) <= new Date(expected.approvedAt) ||
    new Date(expected.retentionDeadline) <= new Date(expected.sourceCapturedAt)
  ) {
    fail();
  }
  const sourceEmpty = expected.storageObjectBytesMode === "source-empty";
  const separate = expected.storageObjectBytesMode === "separate-encrypted-export";
  if (
    (!sourceEmpty && !separate) ||
    (sourceEmpty && expected.storageExportManifestSha256 !== null) ||
    (separate && !digestPattern.test(expected.storageExportManifestSha256))
  ) {
    fail();
  }
  return expected;
}
