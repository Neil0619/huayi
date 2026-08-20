export type AccountStatus = "active" | "disabled" | "deleting";
export type PairingStatus = "pending" | "approved" | "consumed" | "expired";

export interface Invitation {
  claimedByHash?: string;
  consumedBy?: string;
  consumedMethod?: "google" | "password";
  createdAt: Date;
  expiresAt: Date;
  id: string;
  revoked: boolean;
  tokenHash: string;
}
export interface Claim {
  boundUserId?: string;
  expiresAt: Date;
  invitationId: string;
  ticketHash: string;
}
export interface AuthFlow {
  claimTicket?: string;
  expiresAt: Date;
  kind: "invite-registration" | "link-google" | "link-password" | "login" | "reauthenticate-google";
  leaseExpiresAt?: Date;
  leaseHash?: string;
  linkStage?: "claimed" | "provider-started" | "provider-updated" | "refreshed";
  ownerUserId?: string;
  protectedProviderState?: string;
  started?: boolean;
  used: boolean;
  webSessionHash?: string;
}
export interface WebSession {
  access: "data-rights" | "full";
  csrfHash: string;
  expiresAt: Date;
  refreshCiphertext: string;
  reauthenticatedAt: Date;
  reauthenticatedMethod: "google" | "password" | null;
  revoked: boolean;
  userId: string;
}
export interface Pairing {
  deviceLabel?: string;
  expiresAt: Date;
  id: string;
  installIdHash: string;
  pkceChallenge: string;
  stateHash: string;
  status: PairingStatus;
  userId?: string;
}
export interface ExtensionSession {
  createdAt: Date;
  deviceLabel: string;
  expiresAt: Date;
  id: string;
  lastUsedAt: Date | null;
  revoked: boolean;
  tokenHash: string;
  userId: string;
}
