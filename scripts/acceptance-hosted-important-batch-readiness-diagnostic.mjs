const hostedImportantBatchReadinessStages = Object.freeze([
  "repository-state",
  "docker-target",
  "docker-daemon",
  "supabase-cli",
  "filevault",
  "platform-lock",
  "local-platform-images",
  "runtime-inspection",
]);

const readinessStageSet = new Set(hostedImportantBatchReadinessStages);

function repositoryStateIsReady(state) {
  return (
    state?.artifactRootIgnored === true &&
    state.worktreeClean === true &&
    typeof state.candidateCommit === "string" &&
    /^[0-9a-f]{40}$/u.test(state.candidateCommit)
  );
}

function firstRuntimeFailure(runtime) {
  const checks = [
    ["docker-target", runtime?.dockerTargetReady],
    ["docker-daemon", runtime?.dockerDaemonReady],
    ["supabase-cli", runtime?.supabaseCliPinned],
    ["filevault", runtime?.artifactEncryptionReady],
    ["platform-lock", runtime?.platformLockReady],
    [
      "local-platform-images",
      runtime?.localPlatformImagesReady === true &&
        runtime.pinnedPostgres17RuntimeReady === true &&
        runtime.pinnedScratchRuntimeReady === true,
    ],
  ];
  return checks.find(([, ready]) => ready !== true)?.[0] ?? null;
}

function failedReadiness(failedStage) {
  if (!readinessStageSet.has(failedStage)) {
    throw new Error("Hosted important-batch readiness stage is invalid.");
  }
  return Object.freeze({ candidateCommit: null, failedStage, ready: false });
}

export async function assessHostedImportantBatchReadiness({
  inspectRuntime,
  readRepositoryState,
  repositoryRoot,
}) {
  let repositoryState;
  try {
    repositoryState = await readRepositoryState(repositoryRoot);
  } catch {
    return failedReadiness("repository-state");
  }
  if (!repositoryStateIsReady(repositoryState)) {
    return failedReadiness("repository-state");
  }

  let runtime;
  try {
    runtime = await inspectRuntime();
  } catch {
    return failedReadiness("runtime-inspection");
  }
  const failedStage = firstRuntimeFailure(runtime);
  if (failedStage !== null) return failedReadiness(failedStage);

  return Object.freeze({
    candidateCommit: repositoryState.candidateCommit,
    failedStage: null,
    ready: true,
  });
}

export function renderHostedImportantBatchReadinessFailure(failedStage) {
  if (!readinessStageSet.has(failedStage)) {
    throw new Error("Hosted important-batch readiness stage is invalid.");
  }
  return `Hosted important-batch executor readiness failed closed at allowlisted stage ${failedStage}; no operation was performed.\n`;
}
