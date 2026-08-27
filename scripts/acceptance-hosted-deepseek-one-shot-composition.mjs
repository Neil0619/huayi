import { createHostedDeepSeekOneShotExecutor } from "./acceptance-hosted-deepseek-one-shot.mjs";
import {
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
} from "./acceptance-hosted-deepseek-one-shot-plan.mjs";
import { captureHostedDeepSeekDeploymentPair } from "./acceptance-hosted-deepseek-one-shot-deployment-attestation.mjs";
import { createHostedDeepSeekNormalWebHttpTransport } from "./acceptance-hosted-deepseek-one-shot-http-transport.mjs";
import { createHostedDeepSeekPostgresAuthority } from "./acceptance-hosted-deepseek-one-shot-postgres-authority.mjs";
import { createHostedDeepSeekPostgresEvidence } from "./acceptance-hosted-deepseek-one-shot-postgres-evidence.mjs";
import { createHostedDeepSeekNormalWebSessionAdapter } from "./acceptance-hosted-deepseek-one-shot-session.mjs";
import { inspectVercelOneShotGit } from "./acceptance-vercel-one-shot-git.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";

function failedClosed() {
  return new Error(failureMessage);
}

function methodsAreValid(value, names) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    names.every((name) => typeof value[name] === "function")
  );
}

function productionCandidate(candidate) {
  return Object.freeze({
    branch: candidate.branch,
    clean: candidate.clean,
    commit: candidate.commit,
    pushed: candidate.commit === candidate.upstreamCommit,
    upstreamCommit: candidate.upstreamCommit,
  });
}

export function createHostedDeepSeekOneShotProductionSnapshotAdapter({
  captureDeploymentPair = captureHostedDeepSeekDeploymentPair,
  inspectCandidate = inspectVercelOneShotGit,
  readPostEvidence,
  readPreEvidence,
  repositoryRoot = process.cwd(),
  vercelToken,
} = {}) {
  if (
    typeof captureDeploymentPair !== "function" ||
    typeof inspectCandidate !== "function" ||
    typeof readPostEvidence !== "function" ||
    typeof readPreEvidence !== "function"
  ) {
    throw failedClosed();
  }
  return Object.freeze({
    async capturePostSnapshot(control) {
      try {
        const [evidence, deployments] = await Promise.all([
          readPostEvidence(control),
          captureDeploymentPair({ token: vercelToken }),
        ]);
        return Object.freeze({ ...evidence, deployments });
      } catch {
        throw failedClosed();
      }
    },
    async capturePreSnapshot(control) {
      try {
        const [candidate, deployments, evidence] = await Promise.all([
          inspectCandidate({ repositoryRoot }),
          captureDeploymentPair({ token: vercelToken }),
          readPreEvidence(control),
        ]);
        return Object.freeze({
          ...evidence,
          candidate: productionCandidate(candidate),
          deployments,
          route: Object.freeze({ origin: hostedDeepSeekWebOrigin, path: hostedDeepSeekWebPath }),
        });
      } catch {
        throw failedClosed();
      }
    },
  });
}

const defaultFactories = Object.freeze({
  createAuthority: createHostedDeepSeekPostgresAuthority,
  createEvidence: createHostedDeepSeekPostgresEvidence,
  createExecutor: createHostedDeepSeekOneShotExecutor,
  createHttpTransport: createHostedDeepSeekNormalWebHttpTransport,
  createSessionAdapter: createHostedDeepSeekNormalWebSessionAdapter,
});

export function createHostedDeepSeekOneShotProductionExecutor({
  credentials,
  factories = defaultFactories,
  fetch_,
  keyring,
  query,
  readNowMilliseconds,
  snapshot,
} = {}) {
  try {
    if (
      typeof query !== "function" ||
      !methodsAreValid(snapshot, ["capturePostSnapshot", "capturePreSnapshot"]) ||
      !methodsAreValid(factories, [
        "createAuthority",
        "createEvidence",
        "createExecutor",
        "createHttpTransport",
        "createSessionAdapter",
      ])
    ) {
      throw failedClosed();
    }
    const lifecycle = factories.createAuthority({ keyring, query });
    const evidence = factories.createEvidence({ query });
    const transport = factories.createHttpTransport({ credentials, fetch_, readNowMilliseconds });
    const session = factories.createSessionAdapter({ transport });
    const adapter = Object.freeze({
      capturePostSnapshot: snapshot.capturePostSnapshot,
      capturePreSnapshot: snapshot.capturePreSnapshot,
      destroySession: session.destroySession,
      invokeCloudWebAnalysis: session.invokeCloudWebAnalysis,
      loginPassword: session.loginPassword,
      logout: session.logout,
      readOperatorAuthorization: session.readOperatorAuthorization,
      readServerSettlement: evidence.readServerSettlement,
      reauthenticatePassword: session.reauthenticatePassword,
      reconcileDispatchedRequest: evidence.reconcileDispatchedRequest,
      setModelKillSwitch: session.setModelKillSwitch,
    });
    const core = factories.createExecutor({ adapter, lifecycle, readNowMilliseconds });
    if (!methodsAreValid(core, ["execute", "recover", "status"])) throw failedClosed();
    return Object.freeze({
      async execute(...arguments_) {
        try {
          if (arguments_.length !== 1) throw failedClosed();
          const status = await core.status();
          if (!status || !["absent", "terminal"].includes(status.state)) throw failedClosed();
          return await core.execute(arguments_[0]);
        } catch {
          throw failedClosed();
        }
      },
      async recover(...arguments_) {
        try {
          if (arguments_.length !== 0) throw failedClosed();
          return await core.recover();
        } catch {
          throw failedClosed();
        }
      },
      async status(...arguments_) {
        try {
          if (arguments_.length !== 0) throw failedClosed();
          return await core.status();
        } catch {
          throw failedClosed();
        }
      },
    });
  } catch {
    throw failedClosed();
  }
}
