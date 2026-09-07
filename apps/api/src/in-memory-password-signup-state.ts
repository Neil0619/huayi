import { CloudFault } from "./cloud-fault.js";
import type { AuthFlow, Claim, Invitation } from "./identity-state.js";
import { hashSecret, type Clock } from "./security.js";

export function createInMemoryPasswordSignupState(options: {
  authFlows: Map<string, AuthFlow>;
  claims: Map<string, Claim>;
  invitations: Map<string, Invitation>;
  clock: Clock;
  pepper: string;
}) {
  function recoverable(flowId: string) {
    const flow = options.authFlows.get(hashSecret(flowId, options.pepper));
    const claim =
      flow?.claimTicket === undefined
        ? undefined
        : options.claims.get(hashSecret(flow.claimTicket, options.pepper));
    const invitation =
      claim === undefined ? undefined : options.invitations.get(claim.invitationId);
    const now = options.clock.now();
    if (
      flow?.kind !== "invite-registration" ||
      flow.used ||
      flow.protectedProviderState === undefined ||
      claim?.boundUserId === undefined ||
      claim.createdAt.getTime() + 86_400_000 <= now.getTime() ||
      invitation === undefined ||
      invitation.revoked ||
      invitation.consumedBy !== undefined ||
      invitation.expiresAt <= now
    )
      return undefined;
    return { flow, claim, invitation };
  }
  return {
    readPasswordSignupState(flowId: string): string {
      const state = recoverable(flowId)?.flow.protectedProviderState;
      if (state === undefined)
        throw new CloudFault("authentication_required", "Registration is unavailable.");
      return state;
    },
    comparePasswordSignupState(flowId: string, expected: string, next: string): boolean {
      const current = recoverable(flowId);
      if (current === undefined || current.flow.protectedProviderState !== expected) return false;
      const expiresAt = new Date(
        Math.min(
          options.clock.now().getTime() + 900_000,
          current.claim.createdAt.getTime() + 86_400_000,
          current.invitation.expiresAt.getTime(),
        ),
      );
      current.flow.protectedProviderState = next;
      current.flow.expiresAt = expiresAt;
      current.claim.expiresAt = expiresAt;
      return true;
    },
  };
}
