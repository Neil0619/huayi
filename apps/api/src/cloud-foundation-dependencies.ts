import type { AuthProvider } from "./auth-provider.js";
import type { IdentityModule } from "./identity-module.js";
import type { GoogleLinkRepository } from "./google-link-module.js";
import type { PasswordLinkRepository } from "./password-link-module.js";
import type { RateLimiter } from "./rate-limiter.js";

type Awaitable<T> = Promise<T> | T;
interface FoundationIdentity {
  authorizeSignInMethod: IdentityModule["authorizeSignInMethod"];
  authenticateDataRightsMutation: IdentityModule["authenticateDataRightsMutation"];
  authenticateDataRightsSession: IdentityModule["authenticateDataRightsSession"];
  approveExtensionPairing: IdentityModule["approveExtensionPairing"];
  authenticateWebSession: IdentityModule["authenticateWebSession"];
  authenticateWebMutation: IdentityModule["authenticateWebMutation"];
  bindInvitationIdentity: IdentityModule["bindInvitationIdentity"];
  claimInvitation: IdentityModule["claimInvitation"];
  completeAuthFlow: IdentityModule["completeAuthFlow"];
  completeGoogleReauthentication: IdentityModule["completeGoogleReauthentication"];
  completePasswordReauthentication: IdentityModule["completePasswordReauthentication"];
  consumeAuthFlow: IdentityModule["consumeAuthFlow"];
  continueGoogleReauthentication: IdentityModule["continueGoogleReauthentication"];
  createAuthFlow: IdentityModule["createAuthFlow"];
  createLoginAuthFlow: IdentityModule["createLoginAuthFlow"];
  createGoogleReauthentication: IdentityModule["createGoogleReauthentication"];
  createExtensionPairing: IdentityModule["createExtensionPairing"];
  createWebSession: IdentityModule["createWebSession"];
  exchangeExtensionPairing: IdentityModule["exchangeExtensionPairing"];
  finalizeInvitation: IdentityModule["finalizeInvitation"];
  getExtensionPairing: IdentityModule["getExtensionPairing"];
  listExtensionSessions: IdentityModule["listExtensionSessions"];
  preparePasswordReauthentication: IdentityModule["preparePasswordReauthentication"];
  requireClaimTicket: IdentityModule["requireClaimTicket"];
  readAuthFlowState: IdentityModule["readAuthFlowState"];
  requireRecentAuthentication: IdentityModule["requireRecentAuthentication"];
  revokeExtensionSession: IdentityModule["revokeExtensionSession"];
  revokeWebSession: IdentityModule["revokeWebSession"];
  rotateWebCsrf: IdentityModule["rotateWebCsrf"];
  saveAuthFlowState: IdentityModule["saveAuthFlowState"];
}

export interface CloudFoundationDependencies {
  apiOrigin: string;
  auth: AuthProvider;
  extensionOrigin?: string;
  identity: {
    [Key in keyof FoundationIdentity]: (
      ...args: Parameters<FoundationIdentity[Key]>
    ) => Awaitable<ReturnType<FoundationIdentity[Key]>>;
  };
  googleLink: GoogleLinkRepository;
  googleAuthenticationEnabled: boolean;
  passwordLink: PasswordLinkRepository;
  protectRefreshToken: (refreshToken: string) => string;
  protectTransientAuthState?: (state: string) => string;
  rateLimiter: RateLimiter;
  unprotectRefreshToken: (refreshToken: string) => string;
  unprotectTransientAuthState?: (state: string) => string;
  webOrigin: string;
}
