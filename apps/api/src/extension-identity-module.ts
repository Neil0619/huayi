import { createHash } from "node:crypto";
import type { ApproveExtensionPairingRequest, ExtensionPreferences } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { AccountStatus, ExtensionSession, Pairing } from "./identity-state.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

export function createExtensionIdentityModule(options: {
  clock: Clock;
  extensionSessions: Map<string, ExtensionSession>;
  extensionPreferences: Map<string, ExtensionPreferences>;
  pairings: Map<string, Pairing>;
  pepper: string;
  profiles: Map<string, AccountStatus>;
  secrets: SecretSource;
}) {
  const requireActiveProfile = (userId: string) => {
    if (options.profiles.get(userId) !== "active") {
      throw new CloudFault("forbidden", "The account is not active.");
    }
  };
  const identifier = () => opaqueSecret(options.secrets, 16);

  function createExtensionPairing(command: {
    installIdHash: string;
    pkceChallenge: string;
    state: string;
  }) {
    const pairing: Pairing = {
      expiresAt: addMilliseconds(options.clock.now(), 10 * 60 * 1_000),
      id: identifier(),
      installIdHash: command.installIdHash,
      pkceChallenge: command.pkceChallenge,
      stateHash: hashSecret(command.state, options.pepper),
      status: "pending",
    };
    options.pairings.set(pairing.id, pairing);
    return { expiresAt: pairing.expiresAt, id: pairing.id, status: pairing.status };
  }

  function approveExtensionPairing(
    id: string,
    userId: string,
    input: ApproveExtensionPairingRequest,
  ): void {
    requireActiveProfile(userId);
    const pairing = options.pairings.get(id);
    if (
      pairing === undefined ||
      pairing.status !== "pending" ||
      pairing.expiresAt <= options.clock.now()
    ) {
      throw new CloudFault("not_found", "The pairing request is unavailable.");
    }
    const current = options.extensionPreferences.get(userId);
    if (current === undefined || current.revision !== input.expectedPreferencesRevision) {
      throw new CloudFault("revision_conflict", "The preferences revision has changed.");
    }
    const changed =
      current.cloudWordCopyMode !== input.cloudWordCopyMode ||
      current.extensionQueryModelMode !== input.extensionQueryModelMode ||
      current.studyCaptureMode !== input.studyCaptureMode;
    options.extensionPreferences.set(userId, {
      cloudWordCopyMode: input.cloudWordCopyMode,
      extensionQueryModelMode: input.extensionQueryModelMode,
      revision: current.revision + (changed ? 1 : 0),
      studyCaptureMode: input.studyCaptureMode,
      updatedAt: changed ? options.clock.now().toISOString() : current.updatedAt,
    });
    pairing.deviceLabel = input.deviceLabel;
    pairing.status = "approved";
    pairing.userId = userId;
  }

  function exchangeExtensionPairing(id: string, state: string, verifier: string) {
    const pairing = options.pairings.get(id);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      pairing === undefined ||
      pairing.status !== "approved" ||
      pairing.expiresAt <= options.clock.now() ||
      !secretMatches(state, pairing.stateHash, options.pepper) ||
      challenge !== pairing.pkceChallenge ||
      pairing.userId === undefined ||
      pairing.deviceLabel === undefined
    ) {
      throw new CloudFault("forbidden", "The pairing exchange is invalid.");
    }
    pairing.status = "consumed";
    const sessionToken = opaqueSecret(options.secrets);
    const session: ExtensionSession = {
      createdAt: options.clock.now(),
      deviceLabel: pairing.deviceLabel,
      expiresAt: addMilliseconds(options.clock.now(), 90 * 24 * 60 * 60 * 1_000),
      id: identifier(),
      lastUsedAt: null,
      revoked: false,
      tokenHash: hashSecret(sessionToken, options.pepper),
      userId: pairing.userId,
    };
    options.extensionSessions.set(session.id, session);
    const preferences = options.extensionPreferences.get(session.userId);
    if (preferences === undefined) throw new CloudFault("forbidden", "Preferences unavailable.");
    return { expiresAt: session.expiresAt, preferences, sessionId: session.id, sessionToken };
  }

  function revokeAllExtensionSessions(userId: string): number {
    let revoked = 0;
    for (const session of options.extensionSessions.values()) {
      if (session.userId === userId && !session.revoked) {
        session.revoked = true;
        revoked += 1;
      }
    }
    return revoked;
  }

  return {
    approveExtensionPairing,
    authenticateExtension(token: string) {
      const session = [...options.extensionSessions.values()].find((candidate) =>
        secretMatches(token, candidate.tokenHash, options.pepper),
      );
      if (session === undefined || session.revoked || session.expiresAt <= options.clock.now()) {
        throw new CloudFault("authentication_required", "The device session is invalid.");
      }
      requireActiveProfile(session.userId);
      return { userId: session.userId };
    },
    createExtensionPairing,
    exchangeExtensionPairing,
    getExtensionPairing(id: string) {
      const pairing = options.pairings.get(id);
      if (pairing === undefined) throw new CloudFault("not_found", "The pairing was not found.");
      if (pairing.expiresAt <= options.clock.now() && pairing.status !== "consumed") {
        pairing.status = "expired";
      }
      return { expiresAt: pairing.expiresAt, id: pairing.id, status: pairing.status };
    },
    listExtensionSessions(userId: string) {
      requireActiveProfile(userId);
      return [...options.extensionSessions.values()]
        .filter((session) => session.userId === userId && !session.revoked)
        .map((session) => ({
          createdAt: session.createdAt,
          deviceLabel: session.deviceLabel,
          expiresAt: session.expiresAt,
          id: session.id,
          lastUsedAt: session.lastUsedAt,
        }));
    },
    revokeAllExtensionSessions,
    revokeExtensionSession(userId: string, sessionId: string): void {
      const session = options.extensionSessions.get(sessionId);
      if (session === undefined || session.userId !== userId) {
        throw new CloudFault("not_found", "The device session was not found.");
      }
      session.revoked = true;
    },
  };
}
