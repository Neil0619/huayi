import type { SignInMethod } from "@huayi/cloud-contracts";

import { CloudFault } from "./cloud-fault.js";
import type { AccountStatus, AuthFlow, Claim, Invitation } from "./identity-state.js";
import { hashSecret, secretMatches, type Clock } from "./security.js";

interface InMemoryPasswordRegistrationRecoveryOptions {
  authFlows: Map<string, AuthFlow>;
  claims: Map<string, Claim>;
  clock: Clock;
  createProfile(userId: string, email: string, methods: readonly SignInMethod[]): void;
  invitations: Map<string, Invitation>;
  pepper: string;
  profiles: Map<string, AccountStatus>;
}

export function createInMemoryPasswordRegistrationRecovery(
  options: InMemoryPasswordRegistrationRecoveryOptions,
) {
  return function resumeInterruptedPasswordRegistration(
    token: string,
    userId: string,
    email: string,
  ) {
    const invitation = [...options.invitations.values()].find((candidate) =>
      secretMatches(token, candidate.tokenHash, options.pepper),
    );
    const matchingClaims = [...options.claims.values()].filter(
      (candidate) => candidate.invitationId === invitation?.id,
    );
    const claim = matchingClaims[0];
    const matchingFlows = [...options.authFlows.values()].filter(
      (candidate) =>
        candidate.kind === "invite-registration" &&
        candidate.claimTicket !== undefined &&
        claim !== undefined &&
        hashSecret(candidate.claimTicket, options.pepper) === claim.ticketHash,
    );
    const flow = matchingFlows[0];
    if (
      invitation === undefined ||
      invitation.revoked ||
      invitation.consumedBy !== undefined ||
      invitation.expiresAt <= options.clock.now() ||
      matchingClaims.length !== 1 ||
      claim === undefined ||
      claim.expiresAt > options.clock.now() ||
      claim.boundUserId !== userId ||
      matchingFlows.length !== 1 ||
      flow === undefined ||
      flow.used ||
      flow.expiresAt > options.clock.now() ||
      options.profiles.has(userId)
    ) {
      throw new CloudFault("authentication_required", "Registration recovery is unavailable.");
    }
    options.createProfile(userId, email, ["password"]);
    invitation.consumedBy = userId;
    invitation.consumedMethod = "password";
    flow.used = true;
    return { userId };
  };
}
