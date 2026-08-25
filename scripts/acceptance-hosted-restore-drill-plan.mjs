import { createHash } from "node:crypto";

const commitPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const identifierPattern = /^[a-z_][a-z0-9_$.-]{0,127}$/u;
const sections = Object.freeze([
  "pre-data",
  "data",
  "auth-data",
  "storage-data",
  "post-data",
  "sequence",
]);
const objectKinds = new Set([
  "CONSTRAINT",
  "FK CONSTRAINT",
  "FUNCTION",
  "INDEX",
  "SCHEMA",
  "SEQUENCE",
  "SEQUENCE SET",
  "TABLE",
  "TABLE DATA",
  "TRIGGER",
]);
const operationStages = Object.freeze([
  "role-bootstrap",
  "pre-data",
  "data",
  "auth-data",
  "storage-data",
  "post-data",
  "acl",
  "sequence",
  "verify",
]);

function fail() {
  throw new Error("Hosted restore-drill reviewed plan failed.");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validateEntry(entry) {
  if (
    !hasExactKeys(entry, ["id", "name", "objectKind", "schema", "section"]) ||
    !Number.isSafeInteger(entry.id) ||
    entry.id < 1 ||
    !identifierPattern.test(entry.name) ||
    !identifierPattern.test(entry.schema) ||
    !sections.includes(entry.section) ||
    !objectKinds.has(entry.objectKind)
  ) {
    fail();
  }
  const managedData =
    (entry.section === "auth-data" && entry.schema === "auth") ||
    (entry.section === "storage-data" && entry.schema === "storage");
  const applicationSchema = new Set(["huayi_private", "public", "supabase_migrations"]).has(
    entry.schema,
  );
  if (
    (entry.section === "auth-data" || entry.section === "storage-data") !== managedData ||
    (!managedData && !applicationSchema) ||
    (["data", "auth-data", "storage-data"].includes(entry.section) &&
      entry.objectKind !== "TABLE DATA") ||
    (entry.section === "sequence" && entry.objectKind !== "SEQUENCE SET") ||
    (["pre-data", "post-data"].includes(entry.section) &&
      new Set(["SEQUENCE SET", "TABLE DATA"]).has(entry.objectKind))
  ) {
    fail();
  }
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 20_000) fail();
  let previousSection = -1;
  const ids = new Set();
  for (const entry of entries) {
    validateEntry(entry);
    const sectionIndex = sections.indexOf(entry.section);
    if (sectionIndex < previousSection || ids.has(entry.id)) fail();
    previousSection = sectionIndex;
    ids.add(entry.id);
  }
}

export function hostedRestoreTocAllowlistSha256(entries) {
  validateEntries(entries);
  return createHash("sha256")
    .update(`${JSON.stringify(entries)}\n`)
    .digest("hex");
}

export function buildHostedRestoreExecutionPlan({
  archiveEntries,
  reviewedPlan,
  sourceAttestation,
  targetEmptyVerdict,
}) {
  if (
    !hasExactKeys(reviewedPlan, [
      "contract",
      "coverageProfile",
      "entries",
      "migrationHead",
      "sourceCandidateCommit",
      "tocAllowlistSha256",
    ]) ||
    reviewedPlan.contract !== "huayi-hosted-restore-reviewed-plan/v1" ||
    !commitPattern.test(reviewedPlan.sourceCandidateCommit) ||
    !/^\d{14}$/u.test(reviewedPlan.migrationHead) ||
    !digestPattern.test(reviewedPlan.tocAllowlistSha256) ||
    typeof reviewedPlan.coverageProfile !== "string" ||
    reviewedPlan.coverageProfile.length < 1 ||
    reviewedPlan.coverageProfile.length > 128
  ) {
    fail();
  }
  validateEntries(reviewedPlan.entries);
  validateEntries(archiveEntries);
  if (
    JSON.stringify(archiveEntries) !== JSON.stringify(reviewedPlan.entries) ||
    hostedRestoreTocAllowlistSha256(reviewedPlan.entries) !== reviewedPlan.tocAllowlistSha256 ||
    !hasExactKeys(sourceAttestation, [
      "coverageProfile",
      "migrationHead",
      "sourceCandidateCommit",
      "tocAllowlistSha256",
    ]) ||
    sourceAttestation.coverageProfile !== reviewedPlan.coverageProfile ||
    sourceAttestation.migrationHead !== reviewedPlan.migrationHead ||
    sourceAttestation.sourceCandidateCommit !== reviewedPlan.sourceCandidateCommit ||
    sourceAttestation.tocAllowlistSha256 !== reviewedPlan.tocAllowlistSha256
  ) {
    fail();
  }
  if (
    !hasExactKeys(targetEmptyVerdict, [
      "authRowsEmpty",
      "outboundIntegrationsAbsent",
      "platformBaselineExact",
      "productSchemasAbsent",
      "storageRowsEmpty",
      "targetIdentityDigest",
    ]) ||
    !digestPattern.test(targetEmptyVerdict.targetIdentityDigest) ||
    [
      "authRowsEmpty",
      "outboundIntegrationsAbsent",
      "platformBaselineExact",
      "productSchemasAbsent",
      "storageRowsEmpty",
    ].some((key) => targetEmptyVerdict[key] !== true)
  ) {
    fail();
  }
  return Object.freeze({
    contract: "huayi-hosted-restore-execution-plan/v1",
    migrationHead: reviewedPlan.migrationHead,
    operations: operationStages.map((stage) => ({
      entryIds: archiveEntries.filter((entry) => entry.section === stage).map(({ id }) => id),
      stage,
    })),
    sourceCandidateCommit: reviewedPlan.sourceCandidateCommit,
    targetIdentityDigest: targetEmptyVerdict.targetIdentityDigest,
    tocAllowlistSha256: reviewedPlan.tocAllowlistSha256,
  });
}
