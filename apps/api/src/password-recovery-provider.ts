import type { AuthState } from "./auth-provider.js";
import { CloudFault } from "./cloud-fault.js";

export class PasswordRecoveryPasswordRejected extends CloudFault {
  constructor() {
    super("invalid_request", "The new password does not meet the password requirements.");
    this.name = "PasswordRecoveryPasswordRejected";
  }
}

export interface PasswordRecoveryIdentity {
  authState: AuthState;
  email: string;
  userId: string;
}

export interface PasswordRecoveryProvider {
  begin(command: { email: string; redirectTo: string }): Promise<{ authState: AuthState }>;
  exchange(command: { authState: AuthState; code: string }): Promise<PasswordRecoveryIdentity>;
  updatePassword(command: {
    authState: AuthState;
    password: string;
  }): Promise<{ authState: AuthState; userId: string }>;
}
