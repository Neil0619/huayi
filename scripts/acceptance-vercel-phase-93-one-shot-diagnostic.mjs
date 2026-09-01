import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { inspectVercelOneShotGit } from "./acceptance-vercel-one-shot-git.mjs";
import { readVercelOneShotSnapshot } from "./acceptance-vercel-one-shot-remote.mjs";
import { createVercelOneShotStateStore } from "./acceptance-vercel-one-shot-state.mjs";
import { phase93VercelOneShotBaselines } from "./acceptance-vercel-phase-93-one-shot.mjs";

export const phase93VercelDiagnosticArgument =
  "--diagnose-hosted-vercel-phase-93-0023-neil0619s-projects";

const fields = Object.freeze([
  "token_format_exact",
  "credential_valid",
  "state_readable",
  "state_absent",
  "git_readable",
  "git_commit_exact",
  "git_branch_exact",
  "git_clean",
  "api_disarmed",
  "web_disarmed",
  "git_contract_exact",
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
  "api_in_flight_count",
  "api_latest_state",
  "api_latest_id_candidate",
  "api_latest_commit_candidate",
  "web_history_count",
  "web_non_canceled_count",
  "web_in_flight_count",
  "web_latest_state",
  "web_latest_id_candidate",
  "web_latest_commit_candidate",
  "candidate_baseline_exact",
  "contract_exact",
  "state_write_attempted",
]);

export const phase93VercelDiagnosticFieldNames = fields;

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
    latestCommitCandidate: false,
    latestIdCandidate: false,
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
    latestCommitCandidate: latest?.sha === expected.latestCommit,
    latestIdCandidate: latest?.id === expected.latestDeploymentId,
    latestState: latest?.state ?? "absent",
    nonCanceledCount: nonCanceled.length,
  };
}

function render(values) {
  return `${fields.map((name) => `${name}|${values[name]}`).join("\n")}\n`;
}

export async function runPhase93VercelDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  inspectGit_ = inspectVercelOneShotGit,
  readCredential = readHostedCredential,
  readSnapshot_ = readVercelOneShotSnapshot,
  repositoryRoot = process.cwd(),
  stateStore = createVercelOneShotStateStore({
    repositoryRoot,
    stateIdentity: "phase-93-0023",
  }),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== phase93VercelDiagnosticArgument) {
    writeError("Hosted Phase 93 Vercel one-shot diagnostic failed.\n");
    return 1;
  }
  let token;
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    token = await readCredential("vercel-token", { environment });
  } catch {
    token = undefined;
  }
  const tokenExact = tokenFormatExact(token);
  let stateReadable = false;
  let state;
  try {
    state = await stateStore.read();
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
  const api = projectDiagnostic(snapshot?.api, phase93VercelOneShotBaselines.api);
  const web = projectDiagnostic(snapshot?.web, phase93VercelOneShotBaselines.web);
  const gitCommitExact = git !== undefined && git.commit === git.upstreamCommit;
  const gitBranchExact = git?.branch === "codex/settings-configuration";
  const apiDisarmed = git?.apiArmed === false;
  const webDisarmed = git?.webArmed === false;
  const gitContractExact =
    git !== undefined &&
    gitCommitExact &&
    gitBranchExact &&
    git.clean === true &&
    apiDisarmed &&
    webDisarmed;
  const candidateBaselineExact =
    snapshot !== undefined &&
    api.nonCanceledCount === phase93VercelOneShotBaselines.api.count &&
    api.inFlightCount === 0 &&
    api.latestState === "READY" &&
    api.latestIdCandidate &&
    api.latestCommitCandidate &&
    web.nonCanceledCount === phase93VercelOneShotBaselines.web.count &&
    web.inFlightCount === 0 &&
    web.latestState === "READY" &&
    web.latestIdCandidate &&
    web.latestCommitCandidate;
  const credentialValid = requestStatuses[0] === "200";
  const requestContractExact =
    requestCount === requestStages.length && requestStatuses.every((status) => status === "200");
  const contractExact =
    tokenExact &&
    credentialValid &&
    stateReadable &&
    state === undefined &&
    gitContractExact &&
    requestContractExact &&
    candidateBaselineExact;
  const values = {
    token_format_exact: truth(tokenExact),
    credential_valid: truth(credentialValid),
    state_readable: truth(stateReadable),
    state_absent: truth(stateReadable && state === undefined),
    git_readable: truth(git !== undefined),
    git_commit_exact: truth(gitCommitExact),
    git_branch_exact: truth(gitBranchExact),
    git_clean: truth(git?.clean === true),
    api_disarmed: truth(apiDisarmed),
    web_disarmed: truth(webDisarmed),
    git_contract_exact: truth(gitContractExact),
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
    api_in_flight_count: String(api.inFlightCount),
    api_latest_state: api.latestState,
    api_latest_id_candidate: truth(api.latestIdCandidate),
    api_latest_commit_candidate: truth(api.latestCommitCandidate),
    web_history_count: String(web.historyCount),
    web_non_canceled_count: String(web.nonCanceledCount),
    web_in_flight_count: String(web.inFlightCount),
    web_latest_state: web.latestState,
    web_latest_id_candidate: truth(web.latestIdCandidate),
    web_latest_commit_candidate: truth(web.latestCommitCandidate),
    candidate_baseline_exact: truth(candidateBaselineExact),
    contract_exact: truth(contractExact),
    state_write_attempted: "f",
  };
  writeOutput(render(values));
  return contractExact ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPhase93VercelDiagnosticCli();
}
