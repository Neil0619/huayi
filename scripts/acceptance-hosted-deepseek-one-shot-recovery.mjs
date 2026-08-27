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
  createRecoveryEvidenceDeadline,
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
      evidenceBudgetMilliseconds,
      freshnessMilliseconds,
      lifecycle,
      logoutBudgetMilliseconds,
      readNowMilliseconds,
      sessionBudgetMilliseconds,
      setTimeout_,
      signal,
    } = options;
    if (
      !isSafeNonnegativeInteger(budgetMilliseconds) ||
      budgetMilliseconds === 0 ||
      !isSafeNonnegativeInteger(freshnessMilliseconds) ||
      !isSafeNonnegativeInteger(evidenceBudgetMilliseconds) ||
      evidenceBudgetMilliseconds === 0 ||
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
        signal,
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
      nowMilliseconds +
      sessionBudgetMilliseconds +
      evidenceBudgetMilliseconds +
      budgetMilliseconds +
      logoutBudgetMilliseconds;
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
          let evidenceDeadline;
          try {
            const evidenceStartedAt = readNowMilliseconds();
            const evidenceDeadlineAt = evidenceStartedAt + evidenceBudgetMilliseconds;
            if (
              !isSafeNonnegativeInteger(evidenceStartedAt) ||
              !isSafeNonnegativeInteger(evidenceDeadlineAt)
            ) {
              throw failedClosed();
            }
            evidenceDeadline = createRecoveryEvidenceDeadline({
              budgetMilliseconds: evidenceBudgetMilliseconds,
              clearTimeout_,
              deadlineAt: evidenceDeadlineAt,
              externalSignal: signal,
              setTimeout_,
            });
            let requestHandle;
            if (dispatchRecovery.requestId === null) {
              const reconciliation = await evidenceDeadline.run(() =>
                adapter.reconcileDispatchedRequest(
                  createReconciliationRequest(
                    {
                      idempotencyKey: dispatchRecovery.idempotencyKey,
                      operationId: dispatchRecovery.operationLease.operationId,
                      ownerId: dispatchRecovery.operationLease.ownerId,
                    },
                    dispatchRecovery.payloadDigest,
                    dispatchRecovery.operationLease,
                  ),
                  evidenceDeadline.control,
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
              const binding = await evidenceDeadline.run(() =>
                lifecycle.bindRequest(
                  {
                    claimToken: dispatchRecovery.operationLease.claimToken,
                    idempotencyKey: dispatchRecovery.idempotencyKey,
                    idempotencyVerifier: dispatchRecovery.idempotencyVerifier,
                    leaseGeneration: dispatchRecovery.operationLease.leaseGeneration,
                    operationId: dispatchRecovery.operationLease.operationId,
                    ownerId: dispatchRecovery.operationLease.ownerId,
                    requestId: requestHandle.requestId,
                  },
                  evidenceDeadline.control,
                ),
              );
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
            const settlement = await evidenceDeadline.run(() =>
              adapter.readServerSettlement(
                boundIdentity,
                evidenceDeadline.control,
                dispatchRecovery.operationLease,
              ),
            );
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
            const settlementReceipt = await evidenceDeadline.run(() =>
              lifecycle.recordSettlement(
                {
                  claimToken: dispatchRecovery.operationLease.claimToken,
                  leaseGeneration: dispatchRecovery.operationLease.leaseGeneration,
                  operationId: dispatchRecovery.operationLease.operationId,
                  requestId: boundIdentity.requestId,
                },
                evidenceDeadline.control,
              ),
            );
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
          } finally {
            evidenceDeadline?.stop();
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
