import {
  createHostedReleaseState,
  releaseIdForCandidate,
  transitionHostedReleaseState,
} from "./acceptance-hosted-release-contract.mjs";

const uncertaintyPhases = new Set([
  "api-configuring",
  "api-deploying",
  "ci-dispatching",
  "web-deploying",
]);

function fail() {
  throw new Error("Hosted acceptance release orchestration failed closed.");
}

function candidateMatches(actual, candidateSha, requirePushed = false) {
  return (
    actual?.branch === "codex/settings-configuration" &&
    actual.candidateSha === candidateSha &&
    actual.clean === true &&
    actual.vercelDisarmed === true &&
    (!requirePushed || (actual.pushed === true && actual.upstreamSha === candidateSha))
  );
}

function methods(value, names) {
  return (
    typeof value === "object" &&
    value !== null &&
    names.every((name) => typeof value[name] === "function")
  );
}

export async function runHostedReleaseOrchestrator({
  candidateSha,
  ci,
  git,
  mode,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  stateStore,
  vercel,
} = {}) {
  let releaseLock;
  try {
    const releaseId = releaseIdForCandidate(candidateSha);
    if (
      !["advance", "recover"].includes(mode) ||
      typeof now !== "function" ||
      typeof sleep !== "function" ||
      !methods(stateStore, ["acquire", "read", "write"]) ||
      !methods(git, ["inspect", "localQuality", "push"]) ||
      !methods(ci, ["dispatch", "find", "wait"]) ||
      !methods(vercel, ["attest", "configure", "create", "find", "inspect", "wait"])
    ) {
      fail();
    }
    releaseLock = await stateStore.acquire({ recover: mode === "recover" });
    let state = await stateStore.read();
    if (state === undefined) {
      if (mode !== "advance") fail();
      const candidate = await git.inspect();
      if (!candidateMatches(candidate, candidateSha)) fail();
      state = createHostedReleaseState({ candidateSha, now: now() });
      await stateStore.write(state);
    } else if (mode === "advance" && uncertaintyPhases.has(state.phase)) {
      fail();
    }
    if (state.candidateSha !== candidateSha || state.releaseId !== releaseId) fail();

    const advance = async (phase, evidence = {}) => {
      state = transitionHostedReleaseState(state, { ...evidence, now: now(), phase });
      await stateStore.write(state);
    };
    const inspectCandidate = async (requirePushed = false) => {
      if (!candidateMatches(await git.inspect(), candidateSha, requirePushed)) fail();
    };
    const bindCi = async ({ allowDispatch }) => {
      let run = await ci.find({ candidateSha, releaseId });
      if (run === undefined && allowDispatch) {
        await ci.dispatch({ candidateSha, releaseId });
        for (let attempt = 0; attempt < 13 && run === undefined; attempt += 1) {
          if (attempt > 0) await sleep(5_000);
          run = await ci.find({ candidateSha, releaseId });
        }
      }
      if (run === undefined) fail();
      await advance("ci-running", { ciRunId: run.id });
    };
    const bindDeployment = async (kind) => {
      let deployment = await vercel.find({ candidateSha, kind, releaseId });
      deployment ??= await vercel.create({ candidateSha, kind, releaseId });
      const field = kind === "api" ? "apiDeploymentId" : "webDeploymentId";
      await advance(`${kind}-running`, { [field]: deployment.id });
    };

    while (state.phase !== "complete") {
      switch (state.phase) {
        case "candidate-recorded": {
          await inspectCandidate();
          await git.localQuality();
          await inspectCandidate();
          await advance("local-quality-passed");
          break;
        }
        case "local-quality-passed": {
          const candidate = await git.inspect();
          if (!candidateMatches(candidate, candidateSha)) fail();
          if (!candidate.pushed) await git.push({ candidateSha });
          await inspectCandidate(true);
          await advance("candidate-pushed");
          break;
        }
        case "candidate-pushed":
          await inspectCandidate(true);
          await advance("ci-dispatching");
          await bindCi({ allowDispatch: true });
          break;
        case "ci-dispatching":
          await bindCi({ allowDispatch: false });
          break;
        case "ci-running":
          await ci.wait({ candidateSha, releaseId, runId: state.ciRunId });
          await advance("ci-passed");
          break;
        case "ci-passed":
          await inspectCandidate(true);
          await advance("api-configuring");
          await vercel.configure();
          if (!(await vercel.inspect()).configurationReady) fail();
          await advance("api-configured");
          break;
        case "api-configuring": {
          const inspection = await vercel.inspect();
          if (!inspection.configurationReady) await vercel.configure();
          if (!(await vercel.inspect()).configurationReady) fail();
          await advance("api-configured");
          break;
        }
        case "api-configured":
          await inspectCandidate(true);
          await advance("api-deploying");
          await bindDeployment("api");
          break;
        case "api-deploying":
          await bindDeployment("api");
          break;
        case "api-running":
          await vercel.wait({
            candidateSha,
            deploymentId: state.apiDeploymentId,
            kind: "api",
            releaseId,
          });
          await advance("api-ready");
          break;
        case "api-ready":
          await advance("web-deploying");
          await bindDeployment("web");
          break;
        case "web-deploying":
          await bindDeployment("web");
          break;
        case "web-running":
          await vercel.wait({
            candidateSha,
            deploymentId: state.webDeploymentId,
            kind: "web",
            releaseId,
          });
          await advance("postflight");
          break;
        case "postflight":
          await vercel.attest({
            apiDeploymentId: state.apiDeploymentId,
            candidateSha,
            webDeploymentId: state.webDeploymentId,
          });
          await advance("complete");
          break;
        default:
          fail();
      }
    }
    return state;
  } catch {
    fail();
  } finally {
    if (typeof releaseLock === "function") await releaseLock().catch(() => undefined);
  }
}
