import type { AuthState } from "./auth-provider.js";

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
