import { hostedDeepSeekPayloadDigest } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import {
  dispatchAttemptReceiptIsValid,
  operationIdentity,
  reconciledRequestHandle,
  requestBindingIsValid,
  requestHandleIsValid,
  settlementRecordReceiptIsValid,
} from "./acceptance-hosted-deepseek-one-shot-contract.mjs";
import { settlementIsValid } from "./acceptance-hosted-deepseek-one-shot-evidence.mjs";
import {
  createApplicationDeadline,
  createApplicationRequest,
  createReconciliationRequest,
} from "./acceptance-hosted-deepseek-one-shot-runtime.mjs";

const failureMessage = "Hosted Cloud Web DeepSeek one-shot failed closed.";

function failedClosed() {
  return new Error(failureMessage);
}

export async function runHostedDeepSeekOneShotApplication({
  adapter,
  approval,
  applicationDeadlineAt,
  applicationRoute,
  budgetMilliseconds,
  clearTimeout_,
  identity,
  lifecycle,
  operationLease,
  preSnapshot,
  setTimeout_,
  signal,
}) {
  const deadline = createApplicationDeadline({
    budgetMilliseconds,
    clearTimeout_,
    deadlineAt: applicationDeadlineAt,
    externalSignal: signal,
    setTimeout_,
  });
  try {
    await deadline.run(() => adapter.setModelKillSwitch(false, deadline.control));
    const dispatchReceipt = await deadline.run(() =>
      lifecycle.markDispatchAttempted({
        claimToken: operationLease.claimToken,
        leaseGeneration: operationLease.leaseGeneration,
        operationId: operationLease.operationId,
        payloadDigest: hostedDeepSeekPayloadDigest,
      }),
    );
    if (!dispatchAttemptReceiptIsValid(dispatchReceipt, operationLease)) throw failedClosed();
    let requestHandle;
    try {
      requestHandle = await deadline.run(() =>
        adapter.invokeCloudWebAnalysis(
          createApplicationRequest(identity, preSnapshot.deployments, applicationRoute),
          deadline.control,
        ),
      );
    } catch {
      const reconciliation = await deadline.run(() =>
        adapter.reconcileDispatchedRequest(
          createReconciliationRequest(identity, hostedDeepSeekPayloadDigest),
          deadline.control,
        ),
      );
      requestHandle = reconciledRequestHandle(
        reconciliation,
        identity,
        hostedDeepSeekPayloadDigest,
      );
    }
    if (!requestHandleIsValid(requestHandle)) throw failedClosed();
    const requestBinding = await deadline.run(() =>
      lifecycle.bindRequest({
        claimToken: operationLease.claimToken,
        idempotencyKey: operationLease.idempotencyKey,
        leaseGeneration: operationLease.leaseGeneration,
        operationId: operationLease.operationId,
        ownerId: operationLease.ownerId,
        requestId: requestHandle.requestId,
      }),
    );
    if (!requestBindingIsValid(requestBinding, operationLease, requestHandle)) {
      throw failedClosed();
    }
    const boundIdentity = Object.freeze({
      ...operationIdentity(requestBinding),
      requestId: requestBinding.requestId,
    });
    const settlement = await deadline.run(() =>
      adapter.readServerSettlement(boundIdentity, deadline.control),
    );
    if (!settlementIsValid(settlement, approval, preSnapshot, boundIdentity)) {
      throw failedClosed();
    }
    const settlementReceipt = await deadline.run(() =>
      lifecycle.recordSettlement({
        claimToken: operationLease.claimToken,
        leaseGeneration: operationLease.leaseGeneration,
        operationId: operationLease.operationId,
        requestId: boundIdentity.requestId,
        settlement,
      }),
    );
    if (
      !settlementRecordReceiptIsValid(settlementReceipt, operationLease, boundIdentity.requestId)
    ) {
      throw failedClosed();
    }
    return Object.freeze({ identity: boundIdentity, settlement });
  } finally {
    deadline.stop();
  }
}
