import {
  authorizationIsValid,
  cleanupLeaseArmTimeIsValid,
  cleanupLeaseIsValid,
  deploymentsAreValid,
  reconciledRequestHandle,
  requestBindingIsValid,
  requestHandleIsValid,
  settlementRecordReceiptIsValid,
  isSafeNonnegativeInteger,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { settlementIsValid } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";
import { dispatchRecoveryIsValid } from "./acceptance-hosted-deepseek-one-shot-recovery-contract.mjs";
import {
  attemptCleanup,
  completeCleanup,
  completeOperation,
  createReconciliationRequest,
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
    const cleanupClaimCandidate = await lifecycle.claimCleanup();
    const cleanupLeaseCandidate = cleanupClaimCandidate?.cleanupLease ?? cleanupClaimCandidate;
    const cleanupAlreadyCompleted = cleanupClaimCandidate?.cleanupAlreadyCompleted === true;
    const dispatchRecovery = cleanupClaimCandidate?.dispatchRecovery;
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
    if (cleanupAlreadyCompleted) {
      if (
        dispatchRecovery === undefined ||
        !dispatchRecoveryIsValid(dispatchRecovery, recoveryRequiredUntil)
      ) {
        throw failedClosed();
      }
      const acceptedFromAuthority =
        dispatchRecovery.dispatchAttempted &&
        dispatchRecovery.requestId !== null &&
        dispatchRecovery.settlementRecorded;
      const completed = await completeOperation({
        lifecycle,
        operationLease: dispatchRecovery.operationLease,
        outcome: acceptedFromAuthority ? "accepted" : "failed",
      });
      if (!completed || !acceptedFromAuthority) throw failedClosed();
      return Object.freeze({ killSwitchRestored: true, outcome: "accepted" });
    }
    let cleanupAttempt;
    let logoutCompleted = false;
    let operationState;
    let recoveryAccepted = false;
    let recoveryFailed = dispatchRecovery?.dispatchAttempted === false;
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
      if (dispatchRecovery !== undefined) {
        if (!dispatchRecoveryIsValid(dispatchRecovery, recoveryRequiredUntil)) {
          throw failedClosed();
        }
        if (dispatchRecovery.dispatchAttempted) {
          try {
            let requestHandle;
            if (dispatchRecovery.requestId === null) {
              const reconciliation = await adapter.reconcileDispatchedRequest(
                createReconciliationRequest(
                  {
                    idempotencyKey: dispatchRecovery.idempotencyKey,
                    operationId: dispatchRecovery.operationLease.operationId,
                    ownerId: dispatchRecovery.operationLease.ownerId,
                  },
                  dispatchRecovery.payloadDigest,
                ),
              );
              requestHandle = reconciledRequestHandle(
                reconciliation,
                {
                  idempotencyKey: dispatchRecovery.idempotencyKey,
                  operationId: dispatchRecovery.operationLease.operationId,
                  ownerId: dispatchRecovery.operationLease.ownerId,
                },
                dispatchRecovery.payloadDigest,
              );
              if (!requestHandleIsValid(requestHandle)) throw failedClosed();
              const binding = await lifecycle.bindRequest({
                claimToken: dispatchRecovery.operationLease.claimToken,
                idempotencyKey: dispatchRecovery.idempotencyKey,
                idempotencyVerifier: dispatchRecovery.idempotencyVerifier,
                leaseGeneration: dispatchRecovery.operationLease.leaseGeneration,
                operationId: dispatchRecovery.operationLease.operationId,
                ownerId: dispatchRecovery.operationLease.ownerId,
                requestId: requestHandle.requestId,
              });
              if (!requestBindingIsValid(binding, dispatchRecovery.operationLease, requestHandle)) {
                throw failedClosed();
              }
            } else {
              requestHandle = Object.freeze({
                requestId: dispatchRecovery.requestId,
                type: "analysis.started",
              });
            }
            const boundIdentity = Object.freeze({
              idempotencyKey: dispatchRecovery.idempotencyKey,
              operationId: dispatchRecovery.operationLease.operationId,
              ownerId: dispatchRecovery.operationLease.ownerId,
              requestId: requestHandle.requestId,
            });
            const settlement = await adapter.readServerSettlement(boundIdentity);
            const recoverySnapshot = {
              budget: {
                estimatedPeakReservationMicroUsd: settlement?.reservationMicroUsd,
              },
              deployments: cleanupLeaseCandidate.deployments,
              observedAt: dispatchRecovery.observedAt,
            };
            if (
              !settlementIsValid(
                settlement,
                {
                  maximumReservationMicroUsd:
                    dispatchRecovery.operationLease.maximumReservationMicroUsd,
                },
                recoverySnapshot,
                boundIdentity,
              )
            ) {
              throw failedClosed();
            }
            const settlementReceipt = await lifecycle.recordSettlement({
              claimToken: dispatchRecovery.operationLease.claimToken,
              leaseGeneration: dispatchRecovery.operationLease.leaseGeneration,
              operationId: dispatchRecovery.operationLease.operationId,
              requestId: boundIdentity.requestId,
              settlement,
            });
            if (
              !settlementRecordReceiptIsValid(
                settlementReceipt,
                dispatchRecovery.operationLease,
                boundIdentity.requestId,
              )
            ) {
              throw failedClosed();
            }
            recoveryAccepted = true;
          } catch {
            recoveryFailed = true;
          }
        }
      }
      cleanupAttempt = cleanupAlreadyCompleted
        ? { completed: true, postSnapshot: undefined }
        : await attemptCleanup({
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
      if (cleanupAlreadyCompleted) {
        operationState = "running";
      } else if (cleanupAttempt?.completed === true && cleanupAttempt.postSnapshot !== undefined) {
        operationState = await completeCleanup({
          lease: cleanupLeaseCandidate,
          lifecycle,
          postSnapshot: cleanupAttempt.postSnapshot,
        });
      }
      if (
        dispatchRecovery !== undefined &&
        operationState === "running" &&
        cleanupAttempt?.completed === true
      ) {
        try {
          const completed = await completeOperation({
            lifecycle,
            operationLease: dispatchRecovery.operationLease,
            outcome: recoveryAccepted && !recoveryFailed ? "accepted" : "failed",
          });
          if (!completed) recoveryFailed = true;
        } catch {
          recoveryFailed = true;
        }
      }
    }
    const expectedOperationState = dispatchRecovery === undefined ? "terminal" : "running";
    if (
      !cleanupAttempt?.completed ||
      operationState !== expectedOperationState ||
      !logoutCompleted ||
      recoveryFailed
    ) {
      throw failedClosed();
    }
    return Object.freeze({
      killSwitchRestored: true,
      outcome: dispatchRecovery === undefined ? "restored" : "accepted",
    });
  } catch {
    throw failedClosed();
  }
}
