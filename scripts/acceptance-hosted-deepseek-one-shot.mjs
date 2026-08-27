import { pathToFileURL } from "node:url";

import { hostedDeepSeekPayloadDigest } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import {
  approvalIsValid,
  authorizationIsValid,
  cleanupLeaseArmTimeIsValid,
  cleanupLeaseIsValid,
  isSafeNonnegativeInteger,
  operationIdentity,
  operationLeaseFitsCleanupArmWindow,
  operationLeaseIsValid,
  preSnapshotIsValid,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { postSnapshotProvesSuccess } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";
import {
  attemptCleanup,
  completeCleanup,
  completeOperation,
  createCleanupCommand,
  executionDependenciesAreValid,
} from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";
import { runHostedDeepSeekOneShotApplication } from "./acceptance-hosted-deepseek-one-shot-application.mjs";
import {
  createHostedDeepSeekOneShotExecutorFacade,
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekCleanupBudgetMilliseconds,
  hostedDeepSeekLogoutBudgetMilliseconds,
  hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds,
  hostedDeepSeekPreSnapshotFreshnessMilliseconds,
  hostedDeepSeekSessionBudgetMilliseconds,
  hostedDeepSeekStatusBudgetMilliseconds,
} from "./acceptance-hosted-deepseek-one-shot-executor.mjs";
import {
  attemptHostedDeepSeekNormalWebLogout,
  establishHostedDeepSeekNormalWebSession,
} from "./acceptance-hosted-deepseek-one-shot-session.mjs";
import {
  hostedDeepSeekAnalysisStreamPath,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
  renderHostedDeepSeekOneShotPlan,
  runHostedDeepSeekOneShotCli,
} from "./acceptance-hosted-deepseek-one-shot-plan.mjs";

export {
  hostedDeepSeekApplicationBudgetMilliseconds,
  hostedDeepSeekAnalysisStreamPath,
  hostedDeepSeekCleanupBudgetMilliseconds,
  hostedDeepSeekLogoutBudgetMilliseconds,
  hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds,
  hostedDeepSeekOneShotConfirmation,
  hostedDeepSeekPayloadDigest,
  hostedDeepSeekPreSnapshotFreshnessMilliseconds,
  hostedDeepSeekSessionBudgetMilliseconds,
  hostedDeepSeekStatusBudgetMilliseconds,
  hostedDeepSeekWebOrigin,
  hostedDeepSeekWebPath,
  renderHostedDeepSeekOneShotPlan,
  runHostedDeepSeekOneShotCli,
};

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";
const policy = Object.freeze({
  freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
  origin: hostedDeepSeekWebOrigin,
  path: hostedDeepSeekWebPath,
});
const applicationRoute = Object.freeze({
  origin: hostedDeepSeekWebOrigin,
  path: hostedDeepSeekAnalysisStreamPath,
});

function failedClosed() {
  return new Error(failureMessage);
}

async function orchestrateHostedDeepSeekOneShot({
  adapter,
  approval,
  clearTimeout_ = clearTimeout,
  lifecycle,
  readNowMilliseconds = Date.now,
  setTimeout_ = setTimeout,
  signal,
} = {}) {
  try {
    if (
      !approvalIsValid(approval, hostedDeepSeekOneShotConfirmation) ||
      !executionDependenciesAreValid({
        adapter,
        clearTimeout_,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
        signal,
      })
    ) {
      throw failedClosed();
    }
  } catch {
    throw failedClosed();
  }

  let accepted = false;
  let cleanupArmAttempted = false;
  let cleanupCompleted = false;
  let cleanupLease;
  let evidenceAccepted = false;
  let identity;
  let loginEstablished = false;
  let logoutCompleted = false;
  let operationFailed = false;
  let operationLease;
  let postSnapshot;
  let preSnapshot;
  let sessionAttempted = false;
  let settlement;

  try {
    preSnapshot = await adapter.capturePreSnapshot();
    const actionNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(actionNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, actionNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    const operationLeaseCandidate = await lifecycle.claimOperation(
      Object.freeze({
        ...approval,
        deployments: preSnapshot.deployments,
        payloadDigest: hostedDeepSeekPayloadDigest,
      }),
    );
    if (!operationLeaseIsValid(operationLeaseCandidate, approval, actionNowMilliseconds)) {
      throw failedClosed();
    }
    operationLease = operationLeaseCandidate;
    identity = operationIdentity(operationLease);
    const claimNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(claimNowMilliseconds) ||
      !operationLeaseIsValid(operationLease, approval, claimNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, claimNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    sessionAttempted = true;
    const authorization = await establishHostedDeepSeekNormalWebSession({
      adapter,
      budgetMilliseconds: hostedDeepSeekSessionBudgetMilliseconds,
      clearTimeout_,
      externalSignal: signal,
      onLoginEstablished: () => {
        loginEstablished = true;
      },
      readNowMilliseconds,
      setTimeout_,
    });
    const authorizationNowMilliseconds = readNowMilliseconds();
    if (
      !isSafeNonnegativeInteger(authorizationNowMilliseconds) ||
      !authorizationIsValid(
        authorization,
        authorizationNowMilliseconds,
        hostedDeepSeekPreSnapshotFreshnessMilliseconds,
      ) ||
      !operationLeaseIsValid(operationLease, approval, authorizationNowMilliseconds) ||
      !preSnapshotIsValid(preSnapshot, approval, authorizationNowMilliseconds, policy) ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }
    cleanupArmAttempted = true;
    const cleanupLeaseCandidate = await lifecycle.armCleanup(
      createCleanupCommand(operationLease, preSnapshot),
    );
    const deadlineStartMilliseconds = readNowMilliseconds();
    const applicationDeadlineAt =
      deadlineStartMilliseconds + hostedDeepSeekApplicationBudgetMilliseconds;
    const cleanupLeaseRequiredUntil =
      applicationDeadlineAt +
      hostedDeepSeekCleanupBudgetMilliseconds +
      hostedDeepSeekLogoutBudgetMilliseconds;
    const deadlineRangeIsValid =
      isSafeNonnegativeInteger(deadlineStartMilliseconds) &&
      isSafeNonnegativeInteger(applicationDeadlineAt) &&
      isSafeNonnegativeInteger(cleanupLeaseRequiredUntil);
    if (
      deadlineRangeIsValid &&
      cleanupLeaseIsValid(
        cleanupLeaseCandidate,
        preSnapshot.deployments,
        cleanupLeaseRequiredUntil,
      ) &&
      cleanupLeaseArmTimeIsValid(
        cleanupLeaseCandidate,
        preSnapshot.observedAt,
        deadlineStartMilliseconds,
      ) &&
      cleanupLeaseCandidate.operationId === identity.operationId
    ) {
      cleanupLease = cleanupLeaseCandidate;
    }
    if (
      !deadlineRangeIsValid ||
      !operationLeaseIsValid(operationLease, approval, cleanupLeaseRequiredUntil) ||
      !operationLeaseFitsCleanupArmWindow(
        operationLease,
        cleanupLease,
        hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds,
      ) ||
      !preSnapshotIsValid(preSnapshot, approval, deadlineStartMilliseconds, policy) ||
      cleanupLease === undefined ||
      signal?.aborted === true
    ) {
      throw failedClosed();
    }

    const applicationOutcome = await runHostedDeepSeekOneShotApplication({
      adapter,
      approval,
      applicationDeadlineAt,
      applicationRoute,
      budgetMilliseconds: hostedDeepSeekApplicationBudgetMilliseconds,
      clearTimeout_,
      identity,
      lifecycle,
      operationLease,
      preSnapshot,
      setTimeout_,
      signal,
    });
    identity = applicationOutcome.identity;
    settlement = applicationOutcome.settlement;
  } catch {
    operationFailed = true;
  } finally {
    if (cleanupLease !== undefined) {
      const cleanupAttempt = await attemptCleanup({
        adapter,
        budgetMilliseconds: hostedDeepSeekCleanupBudgetMilliseconds,
        clearTimeout_,
        freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
        lease: cleanupLease,
        readNowMilliseconds,
        setTimeout_,
      });
      cleanupCompleted = cleanupAttempt.completed;
      postSnapshot = cleanupAttempt.postSnapshot;
      if (!cleanupCompleted) operationFailed = true;
    }

    if (
      !operationFailed &&
      cleanupCompleted &&
      settlement !== undefined &&
      postSnapshot !== undefined
    ) {
      try {
        const postNowMilliseconds = readNowMilliseconds();
        evidenceAccepted =
          isSafeNonnegativeInteger(postNowMilliseconds) &&
          postSnapshotProvesSuccess(
            postSnapshot,
            preSnapshot,
            settlement,
            cleanupLease,
            identity,
            postNowMilliseconds,
            hostedDeepSeekPreSnapshotFreshnessMilliseconds,
          );
      } catch {
        evidenceAccepted = false;
      }
      if (!evidenceAccepted) operationFailed = true;
    }

    if (sessionAttempted) {
      logoutCompleted = await attemptHostedDeepSeekNormalWebLogout({
        adapter,
        budgetMilliseconds: hostedDeepSeekLogoutBudgetMilliseconds,
        clearTimeout_,
        readNowMilliseconds,
        setTimeout_,
      });
      if (!logoutCompleted) operationFailed = true;
    }

    if (cleanupCompleted && cleanupLease !== undefined && postSnapshot !== undefined) {
      try {
        cleanupCompleted =
          (await completeCleanup({
            lease: cleanupLease,
            lifecycle,
            postSnapshot,
          })) !== null;
      } catch {
        cleanupCompleted = false;
      }
      if (!cleanupCompleted) operationFailed = true;
    }

    if (operationLease !== undefined) {
      accepted =
        evidenceAccepted &&
        cleanupCompleted &&
        loginEstablished &&
        logoutCompleted &&
        !operationFailed;
      const outcome = accepted
        ? "accepted"
        : cleanupArmAttempted && !cleanupCompleted
          ? "failed-cleanup-pending"
          : "failed";
      try {
        if (!(await completeOperation({ lifecycle, operationLease, outcome }))) {
          accepted = false;
          operationFailed = true;
        }
      } catch {
        accepted = false;
        operationFailed = true;
      }
    }
  }

  if (!accepted || operationFailed || settlement === undefined) throw failedClosed();
  return Object.freeze({
    killSwitchRestored: true,
    outcome: "accepted",
  });
}

export function createHostedDeepSeekOneShotExecutor({
  adapter,
  clearTimeout_ = clearTimeout,
  lifecycle,
  readNowMilliseconds = Date.now,
  setTimeout_ = setTimeout,
  signal,
} = {}) {
  return createHostedDeepSeekOneShotExecutorFacade({
    adapter,
    applicationOrchestrator: orchestrateHostedDeepSeekOneShot,
    clearTimeout_,
    lifecycle,
    readNowMilliseconds,
    setTimeout_,
    signal,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepSeekOneShotCli();
}
