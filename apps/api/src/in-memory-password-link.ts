import type { SignInMethod } from "@huayi/cloud-contracts";

import type { SignInMethodRecord } from "./account-sign-in-methods-app.js";
import { CloudFault } from "./cloud-fault.js";
import type { GoogleLinkSessionResult } from "./google-link-module.js";
import type { AuthFlow } from "./identity-state.js";
import type { PasswordLinkRepository } from "./password-link-module.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

interface PasswordLinkSessions {
  complete(sessionId: string, userId: string, refreshCiphertext: string): GoogleLinkSessionResult;
  read(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ): { refreshCiphertext: string; userId: string };
  readRefresh(sessionId: string): { refreshCiphertext: string; userId: string };
  saveRefresh(sessionId: string, userId: string, refreshCiphertext: string): void;
}

export function createInMemoryPasswordLink(options: {
  authFlows: Map<string, AuthFlow>;
  clock: Clock;
  hasMethod(userId: string, method: SignInMethod): boolean;
  listMethods(userId: string): SignInMethodRecord[];
  pepper: string;
  registerMethod(userId: string, method: SignInMethod): void;
  revokeExtensions(userId: string): void;
  secrets: SecretSource;
  sessions: PasswordLinkSessions;
}): PasswordLinkRepository {
  function requireFlow(flowKey: string, sessionId: string) {
    const flow = options.authFlows.get(flowKey);
    if (
      flow === undefined ||
      flow.kind !== "link-password" ||
      flow.used ||
      flow.expiresAt <= options.clock.now() ||
      flow.webSessionHash !== hashSecret(sessionId, options.pepper)
    ) {
      throw new CloudFault("authentication_required", "Password link is unavailable.");
    }
    return flow;
  }

  return {
    claim(sessionId, origin, csrfToken) {
      const current = options.sessions.read(sessionId, origin, csrfToken);
      if (options.hasMethod(current.userId, "password")) {
        throw new CloudFault("sign_in_method_already_linked", "Password is already linked.");
      }
      const sessionHash = hashSecret(sessionId, options.pepper);
      let entry = [...options.authFlows.entries()].find(
        ([, flow]) =>
          flow.kind === "link-password" && !flow.used && flow.webSessionHash === sessionHash,
      );
      if (entry !== undefined && entry[1].expiresAt <= options.clock.now()) {
        entry[1].used = true;
        entry = undefined;
      }
      if (entry === undefined) {
        const flowKey = hashSecret(opaqueSecret(options.secrets), options.pepper);
        const flow: AuthFlow = {
          expiresAt: addMilliseconds(options.clock.now(), 15 * 60 * 1_000),
          kind: "link-password",
          linkStage: "claimed",
          ownerUserId: current.userId,
          used: false,
          webSessionHash: sessionHash,
        };
        options.authFlows.set(flowKey, flow);
        entry = [flowKey, flow];
      }
      const [flowKey, flow] = entry;
      if (flow.leaseExpiresAt !== undefined && flow.leaseExpiresAt > options.clock.now()) {
        throw new CloudFault("authentication_required", "Password link is already continuing.");
      }
      const leaseId = opaqueSecret(options.secrets);
      flow.leaseHash = hashSecret(leaseId, options.pepper);
      flow.leaseExpiresAt = addMilliseconds(options.clock.now(), 30_000);
      if (flow.linkStage === "provider-updated") {
        return { flowKey, leaseId, stage: "provider-updated", userId: current.userId };
      }
      if (flow.linkStage === "refreshed" && flow.protectedProviderState !== undefined) {
        return {
          flowKey,
          leaseId,
          protectedProviderState: flow.protectedProviderState,
          stage: "refreshed",
          userId: current.userId,
        };
      }
      const refresh = options.sessions.readRefresh(sessionId);
      return {
        flowKey,
        leaseId,
        refreshCiphertext: refresh.refreshCiphertext,
        stage: "claimed",
        userId: current.userId,
      };
    },

    complete(flowKey, sessionId, leaseId) {
      const flow = requireFlow(flowKey, sessionId);
      if (
        flow.linkStage !== "provider-updated" ||
        flow.ownerUserId === undefined ||
        flow.leaseHash === undefined ||
        !secretMatches(leaseId, flow.leaseHash, options.pepper) ||
        flow.leaseExpiresAt === undefined ||
        flow.leaseExpiresAt <= options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Password link is unavailable.");
      }
      const current = options.sessions.readRefresh(sessionId);
      const session = options.sessions.complete(
        sessionId,
        flow.ownerUserId,
        current.refreshCiphertext,
      );
      options.registerMethod(flow.ownerUserId, "password");
      options.revokeExtensions(flow.ownerUserId);
      flow.used = true;
      flow.linkStage = "provider-updated";
      return { methods: options.listMethods(flow.ownerUserId), session };
    },

    saveProviderUpdated(flowKey, sessionId, leaseId, providerUserId) {
      const flow = requireFlow(flowKey, sessionId);
      if (
        flow.linkStage !== "refreshed" ||
        flow.ownerUserId !== providerUserId ||
        flow.leaseHash === undefined ||
        !secretMatches(leaseId, flow.leaseHash, options.pepper) ||
        flow.leaseExpiresAt === undefined ||
        flow.leaseExpiresAt <= options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Password link did not match.");
      }
      flow.linkStage = "provider-updated";
    },

    saveRefreshed(
      flowKey,
      sessionId,
      leaseId,
      providerUserId,
      refreshCiphertext,
      protectedProviderState,
    ) {
      const flow = requireFlow(flowKey, sessionId);
      if (
        flow.linkStage !== "claimed" ||
        flow.ownerUserId !== providerUserId ||
        flow.leaseHash === undefined ||
        !secretMatches(leaseId, flow.leaseHash, options.pepper) ||
        flow.leaseExpiresAt === undefined ||
        flow.leaseExpiresAt <= options.clock.now()
      ) {
        throw new CloudFault("authentication_required", "Password link refresh did not match.");
      }
      options.sessions.saveRefresh(sessionId, providerUserId, refreshCiphertext);
      flow.protectedProviderState = protectedProviderState;
      flow.linkStage = "refreshed";
    },
  };
}
