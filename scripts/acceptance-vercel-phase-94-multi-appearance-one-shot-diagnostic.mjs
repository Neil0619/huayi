import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { inspectVercelOneShotGit } from "./acceptance-vercel-one-shot-git.mjs";
import { readVercelOneShotSnapshot } from "./acceptance-vercel-one-shot-remote.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";
import { validatePhase93FreshCsrfVercelCompletion } from "./acceptance-vercel-phase-93-fresh-csrf-completion.mjs";
import { phase94MultiAppearanceVercelOneShotBaselines } from "./acceptance-vercel-phase-94-multi-appearance-one-shot.mjs";

export const phase94MultiAppearanceVercelDiagnosticArgument =
  "--diagnose-hosted-vercel-phase-94-multi-appearance-ui-neil0619s-projects";

const fields = Object.freeze([
  "token_format_exact",
  "credential_valid",
  "historical_state_readable",
  "historical_completion_exact",
  "state_readable",
  "state_absent",
  "git_readable",
  "git_commit_exact",
  "git_branch_exact",
  "git_clean",
  "api_disarmed",
  "web_disarmed",
  "candidate_git_exact",
  "request_1_stage",
  "request_1_status",
  "request_2_stage",
  "request_2_status",
  "request_3_stage",
  "request_3_status",
  "request_4_stage",
  "request_4_status",
  "request_5_stage",
  "request_5_status",
  "request_count",
  "snapshot_readable",
  "api_history_count",
  "api_non_canceled_count",
  "api_baseline_count_exact",
  "api_latest_state",
  "api_latest_ready",
  "api_latest_identity_exact",
  "api_in_flight_count",
  "api_zero_in_flight",
  "web_history_count",
  "web_non_canceled_count",
  "web_baseline_count_exact",
  "web_latest_state",
  "web_latest_ready",
  "web_latest_identity_exact",
  "web_in_flight_count",
  "web_zero_in_flight",
  "history_contract_exact",
  "request_contract_exact",
  "contract_exact",
  "state_write_attempted",
]);

export const phase94MultiAppearanceVercelDiagnosticFieldNames = fields;

const terminalStates = new Set(["CANCELED", "ERROR", "READY"]);
const requestStages = Object.freeze([
  "resolve-team",
  "inspect-api",
  "deployments-api",
  "inspect-web",
  "deployments-web",
]);

function tokenFormatExact(token) {
  return (
    typeof token === "string" &&
    token.length >= 16 &&
    token.length <= 4_096 &&
    token.trim() === token &&
    !/[\r\n\0]/u.test(token)
  );
}

function truth(value) {
  return value ? "t" : "f";
}

function responseStatus(response) {
  return Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599
    ? String(response.status)
    : "unavailable";
}

function emptyProject() {
  return {
    historyCount: 0,
    inFlightCount: 0,
    latestIdentityExact: false,
    latestState: "absent",
    nonCanceledCount: 0,
  };
}

function projectDiagnostic(history, expected) {
  if (!Array.isArray(history)) return emptyProject();
  const nonCanceled = history.filter(({ state }) => state !== "CANCELED");
  const latest = nonCanceled[0];
  return {
    historyCount: history.length,
    inFlightCount: history.filter(({ state }) => !terminalStates.has(state)).length,
    latestIdentityExact:
      latest?.id === expected.latestDeploymentId && latest?.sha === expected.latestCommit,
    latestState: latest?.state ?? "absent",
    nonCanceledCount: nonCanceled.length,
  };
}

function render(values) {
  return `${fields.map((name) => `${name}|${values[name]}`).join("\n")}\n`;
}

export async function runPhase94MultiAppearanceVercelDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  historicalStateStore,
  inspectGit_ = inspectVercelOneShotGit,
  readCredential = readHostedCredential,
  readSnapshot_ = readVercelOneShotSnapshot,
  repositoryRoot = process.cwd(),
  stateStore,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== phase94MultiAppearanceVercelDiagnosticArgument) {
    writeError("Hosted Phase 94 multi-appearance Vercel one-shot diagnostic failed.\n");
    return 1;
  }
  const completionStore =
    historicalStateStore ??
    createVercelOneShotStateStore({
      repositoryRoot,
      stateIdentity: "phase-93-0023-fresh-csrf",
    });
  const currentStore =
    stateStore ??
    createVercelOneShotStateStore({
      repositoryRoot,
      stateIdentity: "phase-94-multi-appearance-ui",
    });
  let historicalStateReadable = false;
  let historicalCompletionExact = false;
  try {
    const historicalState = await completionStore.read();
    historicalStateReadable = true;
    validatePhase93FreshCsrfVercelCompletion(historicalState);
    historicalCompletionExact = true;
  } catch {
    historicalCompletionExact = false;
  }
  let stateReadable = false;
  let state;
  try {
    state = await currentStore.read();
    stateReadable = true;
  } catch {
    state = undefined;
  }
  let git;
  try {
    git = await inspectGit_({ repositoryRoot });
  } catch {
    git = undefined;
  }
  let token;
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    token = await readCredential("vercel-token", { environment });
  } catch {
    token = undefined;
  }
  const tokenExact = tokenFormatExact(token);
  let snapshot;
  let requestCount = 0;
  const requestStatuses = requestStages.map(() => "not_run");
  const observedFetch = async (...arguments__) => {
    const index = requestCount;
    requestCount += 1;
    try {
      const response = await fetch_(...arguments__);
      if (index < requestStatuses.length) requestStatuses[index] = responseStatus(response);
      return response;
    } catch (error) {
      if (index < requestStatuses.length) requestStatuses[index] = "transport_error";
      throw error;
    }
  };
  if (tokenExact) {
    try {
      snapshot = await readSnapshot_({ fetch_: observedFetch, token });
    } catch {
      snapshot = undefined;
    }
  }
  const api = projectDiagnostic(snapshot?.api, phase94MultiAppearanceVercelOneShotBaselines.api);
  const web = projectDiagnostic(snapshot?.web, phase94MultiAppearanceVercelOneShotBaselines.web);
  const gitCommitExact = git !== undefined && git.commit === git.upstreamCommit;
  const gitBranchExact = git?.branch === "codex/settings-configuration";
  const apiDisarmed = git?.apiArmed === false;
  const webDisarmed = git?.webArmed === false;
  const candidateGitExact =
    git !== undefined &&
    gitCommitExact &&
    gitBranchExact &&
    git.clean === true &&
    apiDisarmed &&
    webDisarmed;
  const apiBaselineCountExact =
    api.nonCanceledCount === phase94MultiAppearanceVercelOneShotBaselines.api.count;
  const webBaselineCountExact =
    web.nonCanceledCount === phase94MultiAppearanceVercelOneShotBaselines.web.count;
  const apiLatestReady = api.latestState === "READY";
  const webLatestReady = web.latestState === "READY";
  const apiZeroInFlight = api.inFlightCount === 0;
  const webZeroInFlight = web.inFlightCount === 0;
  const historyContractExact =
    snapshot !== undefined &&
    apiBaselineCountExact &&
    api.latestIdentityExact &&
    apiLatestReady &&
    apiZeroInFlight &&
    webBaselineCountExact &&
    web.latestIdentityExact &&
    webLatestReady &&
    webZeroInFlight;
  const credentialValid = requestStatuses[0] === "200";
  const requestContractExact =
    requestCount === requestStages.length && requestStatuses.every((status) => status === "200");
  const contractExact =
    tokenExact &&
    credentialValid &&
    historicalStateReadable &&
    historicalCompletionExact &&
    stateReadable &&
    state === undefined &&
    candidateGitExact &&
    requestContractExact &&
    historyContractExact;
  const values = {
    token_format_exact: truth(tokenExact),
    credential_valid: truth(credentialValid),
    historical_state_readable: truth(historicalStateReadable),
    historical_completion_exact: truth(historicalCompletionExact),
    state_readable: truth(stateReadable),
    state_absent: truth(stateReadable && state === undefined),
    git_readable: truth(git !== undefined),
    git_commit_exact: truth(gitCommitExact),
    git_branch_exact: truth(gitBranchExact),
    git_clean: truth(git?.clean === true),
    api_disarmed: truth(apiDisarmed),
    web_disarmed: truth(webDisarmed),
    candidate_git_exact: truth(candidateGitExact),
    request_1_stage: requestStages[0],
    request_1_status: requestStatuses[0],
    request_2_stage: requestStages[1],
    request_2_status: requestStatuses[1],
    request_3_stage: requestStages[2],
    request_3_status: requestStatuses[2],
    request_4_stage: requestStages[3],
    request_4_status: requestStatuses[3],
    request_5_stage: requestStages[4],
    request_5_status: requestStatuses[4],
    request_count: String(requestCount),
    snapshot_readable: truth(snapshot !== undefined),
    api_history_count: String(api.historyCount),
    api_non_canceled_count: String(api.nonCanceledCount),
    api_baseline_count_exact: truth(apiBaselineCountExact),
    api_latest_state: api.latestState,
    api_latest_ready: truth(apiLatestReady),
    api_latest_identity_exact: truth(api.latestIdentityExact),
    api_in_flight_count: String(api.inFlightCount),
    api_zero_in_flight: truth(apiZeroInFlight),
    web_history_count: String(web.historyCount),
    web_non_canceled_count: String(web.nonCanceledCount),
    web_baseline_count_exact: truth(webBaselineCountExact),
    web_latest_state: web.latestState,
    web_latest_ready: truth(webLatestReady),
    web_latest_identity_exact: truth(web.latestIdentityExact),
    web_in_flight_count: String(web.inFlightCount),
    web_zero_in_flight: truth(webZeroInFlight),
    history_contract_exact: truth(historyContractExact),
    request_contract_exact: truth(requestContractExact),
    contract_exact: truth(contractExact),
    state_write_attempted: "f",
  };
  writeOutput(render(values));
  return contractExact ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase94MultiAppearanceVercelDiagnosticCli();
}
