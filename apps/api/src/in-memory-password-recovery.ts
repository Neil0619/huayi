import { CloudFault } from "./cloud-fault.js";
import type { PasswordRecoveryRepository } from "./password-recovery-module.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

type RecoveryStage =
  "completed" | "failed" | "provider-updated" | "requested" | "sent" | "verified";

interface RecoveryFlow {
  browserExpiresAt?: Date;
  completionLeaseExpiresAt?: Date;
  completionLeaseHash?: string;
  consumedAt?: Date;
  csrfHash?: string;
  dispatchAt?: Date;
  dispatchLeaseExpiresAt?: Date;
  dispatchLeaseHash?: string;
  email: string;
  expiresAt: Date;
  ownerUserId: string;
  protectedFlowId: string;
  protectedProviderState?: string;
  recoverySessionHash?: string;
  stage: RecoveryStage;
}

interface EligibleRecoveryAccount {
  email: string;
  userId: string;
}

const FLOW_LIFETIME_MS = 30 * 60_000;
const BROWSER_LIFETIME_MS = 15 * 60_000;
const DISPATCH_LEASE_MS = 60_000;
const COMPLETION_LEASE_MS = 30_000;

function unavailable(): CloudFault {
  return new CloudFault("authentication_required", "Password recovery is unavailable.");
}

export function createInMemoryPasswordRecovery(options: {
  clock: Clock;
  findEligibleAccount(email: string): EligibleRecoveryAccount | undefined;
  notifyPasswordReset(userId: string): Promise<void> | void;
  pepper: string;
  protectFlowSecret(value: string): string;
  revokeAllSessions(userId: string): Promise<void> | void;
  secrets: SecretSource;
  unprotectFlowSecret(value: string): string;
  webOrigin: string;
}) {
  const flows = new Map<string, RecoveryFlow>();

  function createSecret(): string {
    return opaqueSecret(options.secrets);
  }

  function findFlow(flowId: string): RecoveryFlow | undefined {
    return flows.get(hashSecret(flowId, options.pepper));
  }

  function fail(flow: RecoveryFlow): void {
    delete flow.completionLeaseExpiresAt;
    delete flow.completionLeaseHash;
    delete flow.dispatchLeaseExpiresAt;
    delete flow.dispatchLeaseHash;
    delete flow.recoverySessionHash;
    delete flow.csrfHash;
    flow.stage = "failed";
  }

  function expireInvalidFlows(): void {
    const now = options.clock.now();
    for (const flow of flows.values()) {
      if (["completed", "failed"].includes(flow.stage)) continue;
      const eligible = options.findEligibleAccount(flow.email);
      if (eligible === undefined || eligible.userId !== flow.ownerUserId) {
        fail(flow);
        continue;
      }
      if (
        flow.expiresAt <= now ||
        (flow.browserExpiresAt !== undefined && flow.browserExpiresAt <= now)
      ) {
        fail(flow);
        continue;
      }
      if (
        flow.stage === "requested" &&
        flow.dispatchAt !== undefined &&
        flow.dispatchLeaseExpiresAt !== undefined &&
        flow.dispatchLeaseExpiresAt <= now
      ) {
        fail(flow);
      }
    }
  }

  function requireDispatchLease(flowId: string, leaseId: string): RecoveryFlow {
    const flow = findFlow(flowId);
    if (
      flow === undefined ||
      flow.stage !== "requested" ||
      flow.dispatchLeaseHash === undefined ||
      flow.dispatchLeaseExpiresAt === undefined ||
      flow.dispatchLeaseExpiresAt <= options.clock.now() ||
      !secretMatches(leaseId, flow.dispatchLeaseHash, options.pepper)
    ) {
      throw unavailable();
    }
    return flow;
  }

  function requireBrowserFlow(recoverySessionId: string): RecoveryFlow {
    expireInvalidFlows();
    const flow = [...flows.values()].find(
      (candidate) =>
        candidate.recoverySessionHash !== undefined &&
        secretMatches(recoverySessionId, candidate.recoverySessionHash, options.pepper),
    );
    if (
      flow === undefined ||
      !["provider-updated", "verified"].includes(flow.stage) ||
      flow.browserExpiresAt === undefined ||
      flow.browserExpiresAt <= options.clock.now()
    ) {
      throw unavailable();
    }
    const eligible = options.findEligibleAccount(flow.email);
    if (eligible === undefined || eligible.userId !== flow.ownerUserId) {
      fail(flow);
      throw unavailable();
    }
    return flow;
  }

  const repository: PasswordRecoveryRepository & {
    inspect(): { completed: number; failed: number; open: number; requested: number };
  } = {
    callback(flowId, providerUserId, providerEmail, protectedProviderState) {
      expireInvalidFlows();
      const flow = findFlow(flowId);
      const eligible = flow === undefined ? undefined : options.findEligibleAccount(flow.email);
      if (
        flow === undefined ||
        flow.stage !== "sent" ||
        eligible === undefined ||
        eligible.userId !== flow.ownerUserId ||
        providerUserId !== flow.ownerUserId ||
        providerEmail.trim().toLowerCase() !== flow.email
      ) {
        if (flow !== undefined && flow.stage === "sent") fail(flow);
        throw unavailable();
      }
      const recoverySessionId = createSecret();
      const csrfToken = createSecret();
      flow.browserExpiresAt = addMilliseconds(options.clock.now(), BROWSER_LIFETIME_MS);
      flow.csrfHash = hashSecret(csrfToken, options.pepper);
      flow.protectedProviderState = protectedProviderState;
      flow.recoverySessionHash = hashSecret(recoverySessionId, options.pepper);
      flow.stage = "verified";
      return { csrfToken, expiresAt: flow.browserExpiresAt, recoverySessionId };
    },

    claimCompletion(recoverySessionId, origin, csrfToken) {
      if (origin !== options.webOrigin) throw unavailable();
      const flow = requireBrowserFlow(recoverySessionId);
      if (flow.csrfHash === undefined || !secretMatches(csrfToken, flow.csrfHash, options.pepper)) {
        throw unavailable();
      }
      if (
        flow.completionLeaseExpiresAt !== undefined &&
        flow.completionLeaseExpiresAt > options.clock.now()
      ) {
        throw unavailable();
      }
      const leaseId = createSecret();
      flow.completionLeaseHash = hashSecret(leaseId, options.pepper);
      flow.completionLeaseExpiresAt = addMilliseconds(options.clock.now(), COMPLETION_LEASE_MS);
      const flowId = options.unprotectFlowSecret(flow.protectedFlowId);
      if (flow.stage === "provider-updated") return { flowId, leaseId, stage: flow.stage };
      if (flow.stage !== "verified") throw unavailable();
      if (flow.protectedProviderState === undefined) throw unavailable();
      return {
        flowId,
        leaseId,
        protectedProviderState: flow.protectedProviderState,
        stage: flow.stage,
      };
    },

    claimDispatch() {
      expireInvalidFlows();
      const now = options.clock.now();
      const flow = [...flows.values()].find(
        (candidate) =>
          candidate.stage === "requested" &&
          candidate.dispatchAt === undefined &&
          (candidate.dispatchLeaseExpiresAt === undefined ||
            candidate.dispatchLeaseExpiresAt <= now),
      );
      if (flow === undefined) return undefined;
      const leaseId = createSecret();
      flow.dispatchLeaseHash = hashSecret(leaseId, options.pepper);
      flow.dispatchLeaseExpiresAt = addMilliseconds(now, DISPATCH_LEASE_MS);
      return {
        email: flow.email,
        flowId: options.unprotectFlowSecret(flow.protectedFlowId),
        leaseId,
      };
    },

    async complete(flowId, leaseId) {
      const flow = findFlow(flowId);
      if (
        flow === undefined ||
        flow.stage !== "provider-updated" ||
        flow.completionLeaseHash === undefined ||
        flow.completionLeaseExpiresAt === undefined ||
        flow.completionLeaseExpiresAt <= options.clock.now() ||
        !secretMatches(leaseId, flow.completionLeaseHash, options.pepper)
      ) {
        throw unavailable();
      }
      flow.stage = "completed";
      flow.consumedAt = options.clock.now();
      delete flow.completionLeaseHash;
      delete flow.completionLeaseExpiresAt;
      delete flow.csrfHash;
      delete flow.recoverySessionHash;
      await options.revokeAllSessions(flow.ownerUserId);
      await options.notifyPasswordReset(flow.ownerUserId);
    },

    failDispatch(flowId, leaseId) {
      const flow = requireDispatchLease(flowId, leaseId);
      if (flow.dispatchAt === undefined) throw unavailable();
      fail(flow);
    },

    inspect() {
      expireInvalidFlows();
      const values = [...flows.values()];
      return {
        completed: values.filter(({ stage }) => stage === "completed").length,
        failed: values.filter(({ stage }) => stage === "failed").length,
        open: values.filter(({ stage }) => !["completed", "failed"].includes(stage)).length,
        requested: values.filter(({ stage }) => stage === "requested").length,
      };
    },

    markDispatched(flowId, leaseId) {
      const flow = requireDispatchLease(flowId, leaseId);
      if (flow.dispatchAt !== undefined) throw unavailable();
      flow.dispatchAt = options.clock.now();
    },

    readProviderState(flowId) {
      expireInvalidFlows();
      const flow = findFlow(flowId);
      if (
        flow === undefined ||
        flow.stage !== "sent" ||
        flow.protectedProviderState === undefined
      ) {
        throw unavailable();
      }
      return flow.protectedProviderState;
    },

    readSession(recoverySessionId, origin) {
      if (origin !== options.webOrigin) throw unavailable();
      const flow = requireBrowserFlow(recoverySessionId);
      const csrfToken = createSecret();
      flow.csrfHash = hashSecret(csrfToken, options.pepper);
      return { csrfToken, expiresAt: flow.browserExpiresAt as Date };
    },

    request({ email }) {
      const normalizedEmail = email.trim().toLowerCase();
      const eligible = options.findEligibleAccount(normalizedEmail);
      if (eligible === undefined || eligible.email.trim().toLowerCase() !== normalizedEmail) return;
      for (const flow of flows.values()) {
        if (flow.ownerUserId === eligible.userId && !["completed", "failed"].includes(flow.stage)) {
          fail(flow);
        }
      }
      const flowId = createSecret();
      flows.set(hashSecret(flowId, options.pepper), {
        email: normalizedEmail,
        expiresAt: addMilliseconds(options.clock.now(), FLOW_LIFETIME_MS),
        ownerUserId: eligible.userId,
        protectedFlowId: options.protectFlowSecret(flowId),
        stage: "requested",
      });
    },

    saveProviderUpdated(flowId, leaseId, providerUserId, protectedProviderState) {
      const flow = findFlow(flowId);
      if (
        flow === undefined ||
        flow.stage !== "verified" ||
        providerUserId !== flow.ownerUserId ||
        flow.completionLeaseHash === undefined ||
        flow.completionLeaseExpiresAt === undefined ||
        flow.completionLeaseExpiresAt <= options.clock.now() ||
        !secretMatches(leaseId, flow.completionLeaseHash, options.pepper)
      ) {
        throw unavailable();
      }
      flow.protectedProviderState = protectedProviderState;
      flow.stage = "provider-updated";
    },

    saveSent(flowId, leaseId, protectedProviderState) {
      const flow = requireDispatchLease(flowId, leaseId);
      if (flow.dispatchAt === undefined) throw unavailable();
      flow.protectedProviderState = protectedProviderState;
      delete flow.dispatchLeaseHash;
      delete flow.dispatchLeaseExpiresAt;
      flow.stage = "sent";
    },
  };
  return repository;
}
