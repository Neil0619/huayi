export const hostedImportantBatchRebuildFailureStages = Object.freeze([
  "source-validation",
  "docker-target",
  "scratch-identity",
  "scratch-start",
  "scratch-runtime",
  "scratch-readiness",
  "baseline",
  "migration-ledger",
  "migration-application",
  "fictional-seed",
  "final-contract",
  "scratch-destroy",
  "evidence-persistence",
]);

const hostedImportantBatchRebuildFailureStageSet = new Set(
  hostedImportantBatchRebuildFailureStages,
);

export class HostedImportantBatchRebuildStageError extends Error {
  constructor(stage) {
    if (!hostedImportantBatchRebuildFailureStageSet.has(stage)) {
      throw new Error("Hosted important-batch rebuild failure stage is invalid.");
    }
    super("Hosted important-batch rebuild failed at an allowlisted stage.");
    this.name = "HostedImportantBatchRebuildStageError";
    this.stage = stage;
  }
}

export function normalizeHostedImportantBatchRebuildStageError(stage, error) {
  return error instanceof HostedImportantBatchRebuildStageError
    ? error
    : new HostedImportantBatchRebuildStageError(stage);
}

export function readHostedImportantBatchRebuildFailureStage(error) {
  return error instanceof HostedImportantBatchRebuildStageError &&
    hostedImportantBatchRebuildFailureStageSet.has(error.stage)
    ? error.stage
    : null;
}

export function renderHostedImportantBatchRebuildFailure(stage) {
  if (!hostedImportantBatchRebuildFailureStageSet.has(stage)) {
    throw new Error("Hosted important-batch rebuild failure stage is invalid.");
  }
  return `Hosted important-batch isolated rebuild failed closed at allowlisted stage ${stage}; Hosted data was not modified.\n`;
}
