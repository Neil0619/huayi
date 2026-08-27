import { recoverHostedDeepSeekOneShotCleanup } from "./acceptance-hosted-deepseek-one-shot-recovery.mjs";
import { readHostedDeepSeekOneShotStatus } from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";

export const hostedDeepSeekApplicationBudgetMilliseconds = 90_000;
export const hostedDeepSeekCleanupBudgetMilliseconds = 10_000;
export const hostedDeepSeekLogoutBudgetMilliseconds = 10_000;
export const hostedDeepSeekOperationLeaseMaximumAfterArmMilliseconds = 120_000;
export const hostedDeepSeekPreflightBudgetMilliseconds = 10_000;
export const hostedDeepSeekPreSnapshotFreshnessMilliseconds = 30_000;
export const hostedDeepSeekRecoveryEvidenceBudgetMilliseconds = 20_000;
export const hostedDeepSeekSessionBudgetMilliseconds = 10_000;
export const hostedDeepSeekStatusBudgetMilliseconds = 5_000;

function failedClosed() {
  return new Error(failureMessage);
}

export function createHostedDeepSeekOneShotExecutorFacade({
  adapter,
  applicationOrchestrator,
  clearTimeout_,
  lifecycle,
  readNowMilliseconds,
  setTimeout_,
  signal,
}) {
  const dependencies = Object.freeze({
    adapter,
    clearTimeout_,
    lifecycle,
    readNowMilliseconds,
    setTimeout_,
    signal,
  });
  return Object.freeze({
    async execute(...arguments_) {
      if (arguments_.length !== 1) throw failedClosed();
      return applicationOrchestrator({
        ...dependencies,
        approval: arguments_[0],
      });
    },
    async recover(...arguments_) {
      if (arguments_.length !== 0) throw failedClosed();
      return recoverHostedDeepSeekOneShotCleanup({
        ...dependencies,
        budgetMilliseconds: hostedDeepSeekCleanupBudgetMilliseconds,
        evidenceBudgetMilliseconds: hostedDeepSeekRecoveryEvidenceBudgetMilliseconds,
        freshnessMilliseconds: hostedDeepSeekPreSnapshotFreshnessMilliseconds,
        logoutBudgetMilliseconds: hostedDeepSeekLogoutBudgetMilliseconds,
        sessionBudgetMilliseconds: hostedDeepSeekSessionBudgetMilliseconds,
      });
    },
    async status(...arguments_) {
      if (arguments_.length !== 0) throw failedClosed();
      return readHostedDeepSeekOneShotStatus({
        ...dependencies,
        budgetMilliseconds: hostedDeepSeekStatusBudgetMilliseconds,
      });
    },
  });
}
