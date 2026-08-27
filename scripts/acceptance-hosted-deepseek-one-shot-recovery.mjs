import {
  authorizationIsValid,
  cleanupLeaseArmTimeIsValid,
  cleanupLeaseIsValid,
  deploymentsAreValid,
  isSafeNonnegativeInteger,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import {
  attemptCleanup,
  completeCleanup,
  executionDependenciesAreValid,
} from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";
import {
  attemptHostedDeepSeekNormalWebLogout,
  establishHostedDeepSeekNormalWebSession,
} from "./acceptance-hosted-deepseek-one-shot-session.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";

function failedClosed() {
  return new Error(failureMessage);
}

export async function recoverHostedDeepSeekOneShotCleanup(options = {}) {
  try {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      ["idempotencyKey", "operationId", "ownerId", "requestId"].some((field) =>
        Object.hasOwn(options, field),
      )
    ) {
      throw failedClosed();
    }
    const {
      adapter,
      budgetMilliseconds,
      clearTimeout_,
      freshnessMilliseconds,
      lifecycle,
      logoutBudgetMilliseconds,
      readNowMilliseconds,
      sessionBudgetMilliseconds,
      setTimeout_,
    } = options;
    if (
      !isSafeNonnegativeInteger(budgetMilliseconds) ||
      budgetMilliseconds === 0 ||
      !isSafeNonnegativeInteger(freshnessMilliseconds) ||
      !isSafeNonnegativeInteger(logoutBudgetMilliseconds) ||
      logoutBudgetMilliseconds === 0 ||
      !isSafeNonnegativeInteger(sessionBudgetMilliseconds) ||
      sessionBudgetMilliseconds === 0 ||
      !executionDependenciesAreValid({
        adapter,
        clearTimeout_,
        lifecycle,
        readNowMilliseconds,
        setTimeout_,
      })
    ) {
      throw failedClosed();
    }
    const cleanupLeaseCandidate = await lifecycle.claimCleanup();
    const nowMilliseconds = readNowMilliseconds();
    const recoveryRequiredUntil =
      nowMilliseconds + sessionBudgetMilliseconds + budgetMilliseconds + logoutBudgetMilliseconds;
    if (
      !isSafeNonnegativeInteger(nowMilliseconds) ||
      !isSafeNonnegativeInteger(recoveryRequiredUntil) ||
      !cleanupLeaseIsValid(
        cleanupLeaseCandidate,
        cleanupLeaseCandidate.deployments,
        recoveryRequiredUntil,
      ) ||
      !cleanupLeaseArmTimeIsValid(cleanupLeaseCandidate, undefined, nowMilliseconds) ||
      !deploymentsAreValid(cleanupLeaseCandidate.deployments)
    ) {
      throw failedClosed();
    }
    let cleanupAttempt;
    let logoutCompleted = false;
    let operationState;
    let sessionAttempted = false;
    try {
      sessionAttempted = true;
      const authorization = await establishHostedDeepSeekNormalWebSession({
        adapter,
        budgetMilliseconds: sessionBudgetMilliseconds,
        clearTimeout_,
        onLoginEstablished: () => undefined,
        readNowMilliseconds,
        setTimeout_,
      });
      const authorizationNow = readNowMilliseconds();
      if (
        !isSafeNonnegativeInteger(authorizationNow) ||
        !authorizationIsValid(authorization, authorizationNow, freshnessMilliseconds)
      ) {
        throw failedClosed();
      }
      cleanupAttempt = await attemptCleanup({
        adapter,
        budgetMilliseconds,
        clearTimeout_,
        freshnessMilliseconds,
        lease: cleanupLeaseCandidate,
        readNowMilliseconds,
        setTimeout_,
      });
    } finally {
      if (sessionAttempted) {
        logoutCompleted = await attemptHostedDeepSeekNormalWebLogout({
          adapter,
          budgetMilliseconds: logoutBudgetMilliseconds,
          clearTimeout_,
          readNowMilliseconds,
          setTimeout_,
        });
      }
      if (cleanupAttempt?.completed === true && cleanupAttempt.postSnapshot !== undefined) {
        operationState = await completeCleanup({
          lease: cleanupLeaseCandidate,
          lifecycle,
          postSnapshot: cleanupAttempt.postSnapshot,
        });
      }
    }
    if (!cleanupAttempt?.completed || operationState !== "terminal" || !logoutCompleted) {
      throw failedClosed();
    }
    return Object.freeze({
      killSwitchRestored: true,
      outcome: "restored",
    });
  } catch {
    throw failedClosed();
  }
}
