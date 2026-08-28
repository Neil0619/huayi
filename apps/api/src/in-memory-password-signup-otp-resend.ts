import { CloudFault } from "./cloud-fault.js";
import type { AccountStatus, AuthFlow, Claim, Invitation } from "./identity-state.js";
import {
  addMilliseconds,
  hashSecret,
  opaqueSecret,
  secretMatches,
  type Clock,
  type SecretSource,
} from "./security.js";

interface InMemoryPasswordSignupOtpResendOptions {
  authFlows: Map<string, AuthFlow>;
  claims: Map<string, Claim>;
  clock: Clock;
  invitations: Map<string, Invitation>;
  pepper: string;
  profiles: Map<string, AccountStatus>;
  secrets: SecretSource;
}

export function createInMemoryPasswordSignupOtpResend(
  options: InMemoryPasswordSignupOtpResendOptions,
) {
  return function renewPasswordRegistrationConfirmation(invitationToken: string) {
    const now = options.clock.now();
    const invitation = [...options.invitations.values()].find((candidate) =>
      secretMatches(invitationToken, candidate.tokenHash, options.pepper),
    );
    const matchingClaims = [...options.claims.values()].filter(
      (candidate) => candidate.invitationId === invitation?.id,
    );
    const claim = matchingClaims[0];
    const matchingFlows = [...options.authFlows.entries()].filter(
      ([, candidate]) =>
        candidate.kind === "invite-registration" &&
        candidate.claimTicket !== undefined &&
        claim !== undefined &&
        hashSecret(candidate.claimTicket, options.pepper) === claim.ticketHash,
    );
    const currentFlow = matchingFlows[0];
    if (
      invitation === undefined ||
      invitation.revoked ||
      invitation.consumedBy !== undefined ||
      matchingClaims.length !== 1 ||
      claim === undefined ||
      claim.boundUserId === undefined ||
      claim.boundEmail === undefined ||
      options.profiles.has(claim.boundUserId) ||
      matchingFlows.length !== 1 ||
      currentFlow === undefined ||
      currentFlow[1].used
    ) {
      throw new CloudFault("authentication_required", "Registration confirmation is unavailable.");
    }
    const expiresAt = addMilliseconds(now, 15 * 60 * 1_000);
    const invitationExpired = invitation.expiresAt <= now;
    if (
      (invitationExpired && (claim.expiresAt > now || currentFlow[1].expiresAt > now)) ||
      (!invitationExpired && expiresAt > invitation.expiresAt)
    ) {
      throw new CloudFault("authentication_required", "Registration confirmation is unavailable.");
    }
    const flowId = opaqueSecret(options.secrets);
    const [currentFlowHash, flow] = currentFlow;
    options.authFlows.delete(currentFlowHash);
    flow.expiresAt = expiresAt;
    options.authFlows.set(hashSecret(flowId, options.pepper), flow);
    claim.expiresAt = expiresAt;
    if (invitationExpired) {
      invitation.expiresAt = addMilliseconds(expiresAt, 15 * 60 * 1_000);
    }
    return { email: claim.boundEmail, expiresAt, flowId };
  };
}
