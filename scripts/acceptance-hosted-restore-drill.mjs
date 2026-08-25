import { pathToFileURL } from "node:url";

import { createHostedRestoreDrillArtifactStore } from "./acceptance-hosted-restore-drill-artifacts.mjs";
import {
  canonicalHostedRestoreDocumentSha256,
  hostedRestoreDrillConfirmation,
  hostedRestoreFailureClasses,
  renderHostedRestoreDrillPlan,
  validateHostedRestoreApprovedPlan,
} from "./acceptance-hosted-restore-drill-contract.mjs";
import { inspectHostedRestoreDrillRepository } from "./acceptance-hosted-restore-drill-repository.mjs";

export { hostedRestoreDrillConfirmation } from "./acceptance-hosted-restore-drill-contract.mjs";

const stageDocuments = Object.freeze({
  cleanup: "cleanupVerification",
  execute: "restoreVerification",
  "retention-close": "sourceDisposition",
  "retention-verify": "sourceRetentionVerification",
  "source-verify": "sourceAttestation",
  "target-verify-empty": "targetEmptyVerification",
});
const stageLifecycles = Object.freeze({
  cleanup: new Set(["failed-cleanup-pending", "restored-verified"]),
  execute: new Set(["target-empty"]),
  "retention-close": new Set([
    "failed-cleaned-retention-pending",
    "failed-target-destroyed",
    "retention-pending",
    "target-destroyed",
  ]),
  "retention-verify": new Set([
    "failed-cleaned-retention-pending",
    "failed-target-destroyed",
    "target-destroyed",
  ]),
  "source-verify": new Set(["planned"]),
  "target-verify-empty": new Set(["source-bound"]),
});
const stageFailureStages = Object.freeze({
  cleanup: new Set(["target-delete"]),
  execute: new Set([
    "role-bootstrap",
    "pre-data",
    "data",
    "auth-data",
    "storage-data",
    "post-data",
    "acl",
    "verify",
  ]),
  "retention-close": new Set(["retention-close"]),
  "retention-verify": new Set(["retention-close"]),
  "source-verify": new Set(["source-verify"]),
  "target-verify-empty": new Set(["target-create", "target-empty"]),
});
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const digestPattern = /^[0-9a-f]{64}$/u;

function fail() {
  throw new Error("Hosted restore-drill stage failed closed.");
}

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function isIso(value) {
  return (
    typeof value === "string" && isoPattern.test(value) && new Date(value).toISOString() === value
  );
}

function readCurrentTime(now) {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail();
  return value;
}

function classifyStageResult(result, stage) {
  if (
    hasExactKeys(result, ["document", "documentName", "outcome"]) &&
    result.outcome === "success" &&
    result.documentName === stageDocuments[stage]
  ) {
    return "success";
  }
  if (
    hasExactKeys(result, [
      "failedAt",
      "failedStage",
      "failureClass",
      "outcome",
      "targetIdentityDigest",
    ]) &&
    result.outcome === "failure" &&
    isIso(result.failedAt) &&
    stageFailureStages[stage].has(result.failedStage) &&
    hostedRestoreFailureClasses.includes(result.failureClass) &&
    (result.targetIdentityDigest === null || digestPattern.test(result.targetIdentityDigest))
  ) {
    return "failure";
  }
  fail();
}

function createFailureDocument({ current, expected, result, stage }) {
  if (stage === "source-verify") fail();
  const source = current.documents.sourceAttestation;
  if (source === undefined) fail();
  const expectedTargetIdentity = current.documents.targetEmptyVerification?.targetIdentityDigest;
  if (
    expectedTargetIdentity !== undefined &&
    result.targetIdentityDigest !== expectedTargetIdentity
  ) {
    fail();
  }
  if (
    expectedTargetIdentity === undefined &&
    result.targetIdentityDigest === null &&
    result.failedStage !== "target-create"
  ) {
    fail();
  }
  return {
    contract: "huayi-hosted-restore-failure/v1",
    drillId: expected.drillId,
    failedAt: result.failedAt,
    failedStage: result.failedStage,
    failureClass: result.failureClass,
    sourceAttestationSha256: canonicalHostedRestoreDocumentSha256(source),
    sourceCandidateCommit: source.sourceCandidateCommit,
    targetIdentityDigest: result.targetIdentityDigest,
    toolCandidateCommit: expected.toolCandidateCommit,
  };
}

function normalizeArguments(arguments_) {
  return arguments_.length === 3 && arguments_[1] === "--"
    ? [arguments_[0], arguments_[2]]
    : arguments_;
}

async function unavailableApprovedPlan() {
  throw new Error("Hosted restore-drill approved plan is not installed.");
}

export async function runHostedRestoreDrillCli({
  arguments_ = process.argv.slice(2),
  createStore = createHostedRestoreDrillArtifactStore,
  externalStages = {},
  inspectRepository = inspectHostedRestoreDrillRepository,
  loadApprovedPlan = unavailableApprovedPlan,
  now = () => new Date(),
  repositoryRoot = process.cwd(),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  arguments_ = normalizeArguments(arguments_);
  if (arguments_.length === 1 && arguments_[0] === "plan") {
    writeOutput(renderHostedRestoreDrillPlan());
    return 0;
  }
  const stage = arguments_[0];
  if (
    arguments_.length !== 2 ||
    arguments_[1] !== hostedRestoreDrillConfirmation ||
    (!Object.hasOwn(stageDocuments, stage) && !new Set(["status", "verify"]).has(stage))
  ) {
    writeError("Hosted restore-drill stage failed closed.\n");
    return 1;
  }
  try {
    const expected = await loadApprovedPlan();
    validateHostedRestoreApprovedPlan(expected);
    const repository = await inspectRepository({ repositoryRoot });
    if (repository.candidateCommit !== expected.toolCandidateCommit) fail();
    const store = createStore({ expected, repositoryRoot });
    const current = await store.read();
    if (stage === "status") {
      writeOutput(`Hosted restore-drill lifecycle: ${current.lifecycle}.\n`);
      return 0;
    }
    if (stage === "verify") {
      if (current.lifecycle !== "restored-verified") fail();
      writeOutput("Hosted restore-drill lifecycle verified: restored-verified.\n");
      return 0;
    }
    if (!stageLifecycles[stage].has(current.lifecycle)) fail();
    if (["retention-close", "retention-verify"].includes(stage)) {
      const deadlineReached = readCurrentTime(now) >= new Date(expected.retentionDeadline);
      if (
        (stage === "retention-close" && !deadlineReached) ||
        (stage === "retention-verify" && deadlineReached)
      ) {
        fail();
      }
    }
    const runStage = externalStages[stage];
    if (typeof runStage !== "function") fail();
    const result = await runStage({
      documents: current.documents,
      expected,
      lifecycle: current.lifecycle,
    });
    const outcome = classifyStageResult(result, stage);
    if (outcome === "failure") {
      if (stage === "source-verify") fail();
      if (current.documents.failureVerification === undefined) {
        await store.append(
          "failureVerification",
          createFailureDocument({ current, expected, result, stage }),
        );
      }
      writeError("Hosted restore-drill stage failed closed.\n");
      return 1;
    }
    await store.append(result.documentName, result.document);
    writeOutput(`Hosted restore-drill stage passed: ${stage}.\n`);
    return 0;
  } catch {
    writeError("Hosted restore-drill stage failed closed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedRestoreDrillCli();
}
