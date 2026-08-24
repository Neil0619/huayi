import { CloudFault } from "./cloud-fault.js";
import type { ExtensionPreferences, SignInMethod } from "@huayi/cloud-contracts";
import { createExtensionIdentityModule } from "./extension-identity-module.js";
import { createInMemorySignInMethods } from "./in-memory-sign-in-methods.js";
import { createInMemoryGoogleLink } from "./in-memory-google-link.js";
import { createInMemoryGoogleReauthentication } from "./in-memory-google-reauthentication.js";
import { createInMemoryPasswordLink } from "./in-memory-password-link.js";
import { createInMemoryPasswordRegistrationRecovery } from "./in-memory-password-registration-recovery.js";
import { createInMemoryPasswordSignupOtpResend } from "./in-memory-password-signup-otp-resend.js";
import { createInMemoryWebSessions } from "./in-memory-web-sessions.js";
import type {
  AccountStatus,
  AuthFlow,
  Claim,
  ExtensionSession,
  Invitation,
  Pairing,
} from "./identity-state.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

export interface IdentityModuleOptions {
  clock: Clock;
  pepper: string;
  secrets: SecretSource;
  webOrigin: string;
}

export function createIdentityModule(options: IdentityModuleOptions) {
  const profiles = new Map<string, AccountStatus>();
  const profileEmails = new Map<string, string>();
  const invitations = new Map<string, Invitation>();
  const claims = new Map<string, Claim>();
  const authFlows = new Map<string, AuthFlow>();
  const pairings = new Map<string, Pairing>();
  const extensionSessions = new Map<string, ExtensionSession>();
  const extensionPreferences = new Map<string, ExtensionPreferences>();
  const extensionIdentity = createExtensionIdentityModule({
    clock: options.clock,
    extensionSessions,
    extensionPreferences,
    pairings,
    pepper: options.pepper,
    profiles,
    secrets: options.secrets,
  });
  const { authorizeSignInMethod, listSignInMethods, registerSignInMethods } =
    createInMemorySignInMethods({ clock: options.clock, profiles });
  const web = createInMemoryWebSessions({
    authorizeMethod: authorizeSignInMethod,
    clock: options.clock,
    pepper: options.pepper,
    profileEmails,
    profiles,
    secrets: options.secrets,
    webOrigin: options.webOrigin,
  });
  const { googleLinkSessions, passwordLinkSessions, ...webIdentity } = web;
  const googleLink = createInMemoryGoogleLink({
    authFlows,
    clock: options.clock,
    hasMethod: (userId, method) =>
      listSignInMethods(userId).some((candidate) => candidate.method === method),
    pepper: options.pepper,
    registerMethod: (userId, method) => registerSignInMethods(userId, [method]),
    revokeExtensions: extensionIdentity.revokeAllExtensionSessions,
    secrets: options.secrets,
    sessions: googleLinkSessions,
  });
  const passwordLink = createInMemoryPasswordLink({
    authFlows,
    clock: options.clock,
    hasMethod: (userId, method) =>
      listSignInMethods(userId).some((candidate) => candidate.method === method),
    listMethods: listSignInMethods,
    pepper: options.pepper,
    registerMethod: (userId, method) => registerSignInMethods(userId, [method]),
    revokeExtensions: extensionIdentity.revokeAllExtensionSessions,
    secrets: options.secrets,
    sessions: passwordLinkSessions,
  });

  function identifier(): string {
    return opaqueSecret(options.secrets, 16);
  }
  function createProfile(
    userId: string,
    email = `${userId}@example.test`,
    methods: readonly SignInMethod[] = [],
  ): void {
    const existing = profiles.get(userId);
    if (existing !== undefined && existing !== "active") {
      throw new CloudFault("forbidden", "The account cannot be activated by this flow.");
    }
    profiles.set(userId, "active");
    if (!extensionPreferences.has(userId)) {
      extensionPreferences.set(userId, {
        cloudWordCopyMode: "enabled",
        extensionQueryModelMode: "platform",
        revision: 1,
        studyCaptureMode: "manual",
        updatedAt: options.clock.now().toISOString(),
      });
    }
    profileEmails.set(userId, email.trim().toLowerCase());
    registerSignInMethods(userId, methods);
  }
  function createInvitation(createdBy: string, expiresInHours: number) {
    const token = opaqueSecret(options.secrets);
    const invitation: Invitation = {
      createdAt: options.clock.now(),
      expiresAt: addMilliseconds(options.clock.now(), expiresInHours * 60 * 60 * 1_000),
      id: identifier(),
      revoked: false,
      tokenHash: hashSecret(token, options.pepper),
    };
    invitations.set(invitation.id, invitation);
    return {
      consumedAt: null,
      createdAt: invitation.createdAt,
      createdBy,
      expiresAt: invitation.expiresAt,
      id: invitation.id,
      revokedAt: null,
      token,
    };
  }
  function claimInvitation(token: string) {
    const invitation = [...invitations.values()].find((candidate) =>
      secretMatches(token, candidate.tokenHash, options.pepper),
    );
    if (invitation === undefined || invitation.revoked) {
      throw new CloudFault("invitation_invalid", "The invitation is invalid.");
    }
    if (invitation.expiresAt <= options.clock.now()) {
      throw new CloudFault("invitation_expired", "The invitation has expired.");
    }
    if (invitation.consumedBy !== undefined) {
      throw new CloudFault("invitation_consumed", "The invitation is unavailable.");
    }
    if (invitation.claimedByHash !== undefined) {
      const priorClaim = claims.get(invitation.claimedByHash);
      if (
        priorClaim === undefined ||
        priorClaim.expiresAt > options.clock.now() ||
        priorClaim.boundUserId !== undefined
      ) {
        throw new CloudFault("invitation_consumed", "The invitation is unavailable.");
      }
      claims.delete(invitation.claimedByHash);
      for (const [flowHash, flow] of authFlows) {
        if (
          flow.kind === "invite-registration" &&
          flow.claimTicket !== undefined &&
          hashSecret(flow.claimTicket, options.pepper) === invitation.claimedByHash
        ) {
          authFlows.delete(flowHash);
        }
      }
      delete invitation.claimedByHash;
    }
    const claimTicket = opaqueSecret(options.secrets);
    const ticketHash = hashSecret(claimTicket, options.pepper);
    invitation.claimedByHash = ticketHash;
    const claim = {
      expiresAt: addMilliseconds(options.clock.now(), 15 * 60 * 1_000),
      invitationId: invitation.id,
      ticketHash,
    };
    claims.set(ticketHash, claim);
    return { claimTicket, expiresAt: claim.expiresAt };
  }
  function finalizeInvitation(
    claimTicket: string,
    userId: string,
    email: string,
    method: SignInMethod,
  ) {
    const ticketHash = hashSecret(claimTicket, options.pepper);
    const claim = claims.get(ticketHash);
    const invitation = claim === undefined ? undefined : invitations.get(claim.invitationId);
    if (
      claim === undefined ||
      invitation === undefined ||
      claim.expiresAt <= options.clock.now() ||
      invitation.expiresAt <= options.clock.now() ||
      invitation.revoked ||
      claim.boundUserId !== userId
    ) {
      throw new CloudFault("invitation_invalid", "The claim ticket is invalid.");
    }
    if (invitation.consumedBy !== undefined) {
      if (invitation.consumedBy === userId && invitation.consumedMethod === method) {
        return { userId };
      }
      throw new CloudFault("invitation_consumed", "The invitation was already consumed.");
    }
    if (profiles.has(userId)) {
      throw new CloudFault("invitation_invalid", "The invitation requires a new account.");
    }
    createProfile(userId, email, [method]);
    invitation.consumedBy = userId;
    invitation.consumedMethod = method;
    return { userId };
  }
  function requireClaimTicket(claimTicket: string) {
    const ticketHash = hashSecret(claimTicket, options.pepper);
    const claim = claims.get(ticketHash);
    const invitation = claim === undefined ? undefined : invitations.get(claim.invitationId);
    if (
      claim === undefined ||
      invitation === undefined ||
      claim.expiresAt <= options.clock.now() ||
      invitation.expiresAt <= options.clock.now() ||
      invitation.revoked ||
      invitation.consumedBy !== undefined
    ) {
      throw new CloudFault("invitation_invalid", "The claim ticket is invalid.");
    }
    return { expiresAt: claim.expiresAt };
  }

  function bindInvitationIdentity(claimTicket: string, userId: string, email: string): void {
    requireClaimTicket(claimTicket);
    const claim = claims.get(hashSecret(claimTicket, options.pepper));
    if (claim === undefined) throw new CloudFault("invitation_invalid", "Invalid claim ticket.");
    if (claim.boundUserId !== undefined && claim.boundUserId !== userId) {
      throw new CloudFault("invitation_consumed", "The claim is bound to another identity.");
    }
    claim.boundUserId = userId;
    claim.boundEmail = email.trim().toLowerCase();
  }

  function createAuthFlow(claimTicket: string) {
    const claim = requireClaimTicket(claimTicket);
    const flowId = opaqueSecret(options.secrets);
    authFlows.set(hashSecret(flowId, options.pepper), {
      claimTicket,
      expiresAt: claim.expiresAt,
      kind: "invite-registration",
      used: false,
    });
    return { expiresAt: claim.expiresAt, flowId };
  }

  function createLoginAuthFlow() {
    const flowId = opaqueSecret(options.secrets);
    const expiresAt = addMilliseconds(options.clock.now(), 15 * 60 * 1_000);
    authFlows.set(hashSecret(flowId, options.pepper), {
      expiresAt,
      kind: "login",
      used: false,
    });
    return { expiresAt, flowId };
  }

  function consumeAuthFlow(flowId: string): string {
    const flow = authFlows.get(hashSecret(flowId, options.pepper));
    if (flow === undefined || flow.used || flow.expiresAt <= options.clock.now()) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    if (flow.claimTicket === undefined) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    flow.used = true;
    return flow.claimTicket;
  }

  function saveAuthFlowState(flowId: string, protectedProviderState: string): void {
    const flow = authFlows.get(hashSecret(flowId, options.pepper));
    if (
      flow === undefined ||
      flow.used ||
      flow.expiresAt <= options.clock.now() ||
      (flow.kind === "reauthenticate-google" && flow.started !== true)
    ) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    flow.protectedProviderState = protectedProviderState;
  }

  function readAuthFlowState(flowId: string): string {
    const flow = authFlows.get(hashSecret(flowId, options.pepper));
    if (
      flow === undefined ||
      flow.used ||
      flow.expiresAt <= options.clock.now() ||
      flow.protectedProviderState === undefined
    ) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    return flow.protectedProviderState;
  }

  function completeAuthFlow(flowId: string, userId: string, email: string, method: SignInMethod) {
    const flow = authFlows.get(hashSecret(flowId, options.pepper));
    if (flow === undefined || flow.used || flow.expiresAt <= options.clock.now()) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    if (flow.kind === "login") {
      if (method !== "google") {
        throw new CloudFault("authentication_required", "The authentication flow is invalid.");
      }
      authorizeSignInMethod(userId, "google");
      flow.used = true;
      profileEmails.set(userId, email.trim().toLowerCase());
      return { userId };
    }
    if (flow.kind !== "invite-registration" || flow.claimTicket === undefined) {
      throw new CloudFault("authentication_required", "The authentication flow is invalid.");
    }
    const claimTicket = flow.claimTicket;
    bindInvitationIdentity(claimTicket, userId, email);
    const result = finalizeInvitation(claimTicket, userId, email, method);
    flow.used = true;
    return result;
  }

  const resumeInterruptedPasswordRegistration = createInMemoryPasswordRegistrationRecovery({
    authFlows,
    claims,
    clock: options.clock,
    createProfile,
    invitations,
    pepper: options.pepper,
    profiles,
  });
  const renewPasswordRegistrationConfirmation = createInMemoryPasswordSignupOtpResend({
    authFlows,
    claims,
    clock: options.clock,
    invitations,
    pepper: options.pepper,
    profiles,
    secrets: options.secrets,
  });
  const googleReauthentication = createInMemoryGoogleReauthentication({
    authFlows,
    authorizeGoogle: (userId) => authorizeSignInMethod(userId, "google"),
    clock: options.clock,
    pepper: options.pepper,
    secrets: options.secrets,
    web,
  });

  function setAccountStatus(userId: string, status: AccountStatus): void {
    if (!profiles.has(userId)) throw new CloudFault("not_found", "The account was not found.");
    profiles.set(userId, status);
    if (status !== "active") {
      web.revokeAllWebSessions(userId);
      extensionIdentity.revokeAllExtensionSessions(userId);
    }
  }

  return {
    ...extensionIdentity,
    ...googleReauthentication,
    ...webIdentity,
    authorizeSignInMethod,
    bindInvitationIdentity,
    claimInvitation,
    completeAuthFlow,
    consumeAuthFlow,
    createAuthFlow,
    createInvitation,
    createLoginAuthFlow,
    createProfile,
    finalizeInvitation,
    googleLink,
    listSignInMethods,
    passwordLink,
    requireClaimTicket,
    readAuthFlowState,
    renewPasswordRegistrationConfirmation,
    resumeInterruptedPasswordRegistration,
    saveAuthFlowState,
    setAccountStatus,
  };
}

export type IdentityModule = ReturnType<typeof createIdentityModule>;
