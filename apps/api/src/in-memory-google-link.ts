import type { SignInMethod } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { GoogleLinkRepository } from "./google-link-module.js";
import type { AuthFlow } from "./identity-state.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

interface GoogleLinkWebSessions {
  complete(
    sessionId: string,
    userId: string,
    refreshCiphertext: string,
  ): {
    access: "full";
    csrfToken: string;
    expiresAt: Date;
    sessionId: string;
    setCookie: string;
  };
  read(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ): { refreshCiphertext: string; userId: string };
  readRefresh(sessionId: string): { refreshCiphertext: string; userId: string };
  saveRefresh(sessionId: string, userId: string, refreshCiphertext: string): void;
}

export function createInMemoryGoogleLink(options: {
  authFlows: Map<string, AuthFlow>;
  clock: Clock;
  hasMethod(userId: string, method: SignInMethod): boolean;
  pepper: string;
  registerMethod(userId: string, method: SignInMethod): void;
  revokeExtensions(userId: string): void;
  secrets: SecretSource;
  sessions: GoogleLinkWebSessions;
}): GoogleLinkRepository {
  const flow = (flowId: string) => options.authFlows.get(hashSecret(flowId, options.pepper));
  const requireFlow = (flowId: string, sessionId: string) => {
    const candidate = flow(flowId);
    if (
      candidate === undefined ||
      candidate.kind !== "link-google" ||
      candidate.used ||
      candidate.expiresAt <= options.clock.now() ||
      candidate.webSessionHash !== hashSecret(sessionId, options.pepper)
    ) {
      throw new CloudFault("authentication_required", "Google link is unavailable.");
    }
    return candidate;
  };

  return {
    claimContinuation(flowId, sessionId) {
      const candidate = requireFlow(flowId, sessionId);
      if (candidate.linkStage === "provider-started") {
        throw new CloudFault("authentication_required", "Google link is unavailable.");
      }
      if (
        candidate.leaseExpiresAt !== undefined &&
        candidate.leaseExpiresAt > options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Google link is already continuing.");
      }
      const leaseId = opaqueSecret(options.secrets);
      candidate.leaseHash = hashSecret(leaseId, options.pepper);
      candidate.leaseExpiresAt = addMilliseconds(options.clock.now(), 30_000);
      if (candidate.linkStage === "refreshed") {
        if (candidate.protectedProviderState === undefined) {
          throw new CloudFault("authentication_required", "Google link is unavailable.");
        }
        return {
          leaseId,
          protectedProviderState: candidate.protectedProviderState,
          stage: "refreshed",
          userId: candidate.ownerUserId ?? "",
        };
      }
      const current = options.sessions.readRefresh(sessionId);
      return {
        leaseId,
        refreshCiphertext: current.refreshCiphertext,
        stage: "claimed",
        userId: current.userId,
      };
    },

    complete(flowId, sessionId, providerUserId, refreshCiphertext) {
      const candidate = requireFlow(flowId, sessionId);
      if (
        candidate.linkStage !== "provider-started" ||
        candidate.protectedProviderState === undefined
      ) {
        throw new CloudFault("authentication_required", "Google link is unavailable.");
      }
      if (candidate.ownerUserId !== providerUserId) {
        candidate.used = true;
        throw new CloudFault("authentication_required", "Google link did not match.");
      }
      options.registerMethod(providerUserId, "google");
      options.revokeExtensions(providerUserId);
      const session = options.sessions.complete(sessionId, providerUserId, refreshCiphertext);
      candidate.used = true;
      return session;
    },

    create(sessionId, origin, csrfToken) {
      const current = options.sessions.read(sessionId, origin, csrfToken);
      if (options.hasMethod(current.userId, "google")) {
        throw new CloudFault("sign_in_method_already_linked", "Google is already linked.");
      }
      for (const existing of options.authFlows.values()) {
        if (
          existing.kind === "link-google" &&
          !existing.used &&
          existing.webSessionHash === hashSecret(sessionId, options.pepper)
        ) {
          if (existing.expiresAt > options.clock.now()) {
            throw new CloudFault("authentication_required", "Google link is already active.");
          }
          existing.used = true;
        }
      }
      const flowId = opaqueSecret(options.secrets);
      const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
      options.authFlows.set(hashSecret(flowId, options.pepper), {
        expiresAt,
        kind: "link-google",
        linkStage: "claimed",
        ownerUserId: current.userId,
        used: false,
        webSessionHash: hashSecret(sessionId, options.pepper),
      });
      return { expiresAt, flowId };
    },

    readProviderState(flowId, sessionId) {
      const candidate = requireFlow(flowId, sessionId);
      if (
        candidate.linkStage !== "provider-started" ||
        candidate.protectedProviderState === undefined
      ) {
        throw new CloudFault("authentication_required", "Google link is unavailable.");
      }
      return candidate.protectedProviderState;
    },

    saveProviderStarted(flowId, sessionId, leaseId, protectedProviderState) {
      const candidate = requireFlow(flowId, sessionId);
      if (
        candidate.linkStage !== "refreshed" ||
        candidate.leaseHash === undefined ||
        !secretMatches(leaseId, candidate.leaseHash, options.pepper) ||
        candidate.leaseExpiresAt === undefined ||
        candidate.leaseExpiresAt <= options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Google link lease is unavailable.");
      }
      candidate.linkStage = "provider-started";
      candidate.protectedProviderState = protectedProviderState;
      delete candidate.leaseHash;
      delete candidate.leaseExpiresAt;
    },

    saveRefreshed(flowId, sessionId, leaseId, userId, refreshCiphertext, protectedProviderState) {
      const candidate = requireFlow(flowId, sessionId);
      if (
        candidate.linkStage !== "claimed" ||
        candidate.ownerUserId !== userId ||
        candidate.leaseHash === undefined ||
        !secretMatches(leaseId, candidate.leaseHash, options.pepper) ||
        candidate.leaseExpiresAt === undefined ||
        candidate.leaseExpiresAt <= options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Google link refresh did not match.");
      }
      options.sessions.saveRefresh(sessionId, userId, refreshCiphertext);
      candidate.linkStage = "refreshed";
      candidate.protectedProviderState = protectedProviderState;
    },
  };
}
