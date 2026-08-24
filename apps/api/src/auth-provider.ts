export interface AuthSession {
  email: string;
  refreshToken: string;
  userId: string;
}
export type AuthState = Readonly<Record<string, string>>;

export interface PendingAuthIdentity {
  authState: AuthState;
  email: string;
  emailConfirmationRequired: boolean;
  session?: AuthSession;
  userId: string;
}

export interface AuthProvider {
  beginGoogleLink(command: {
    authState: AuthState;
    redirectTo: string;
  }): Promise<{ authState: AuthState; redirectUrl: string }>;
  beginGoogle(command: {
    redirectTo: string;
  }): Promise<{ authState: AuthState; redirectUrl: string }>;
  completeCode(command: { authState: AuthState; code: string }): Promise<AuthSession>;
  registerPassword(command: {
    email: string;
    password: string;
    redirectTo: string;
  }): Promise<PendingAuthIdentity>;
  refreshSession(command: {
    refreshToken: string;
  }): Promise<{ authState: AuthState; session: AuthSession }>;
  resendPasswordRegistrationOtp(command: { email: string; redirectTo: string }): Promise<void>;
  setPassword(command: {
    authState: AuthState;
    password: string;
  }): Promise<{ authState: AuthState; userId: string }>;
  signInWithPassword(command: { email: string; password: string }): Promise<AuthSession>;
  verifyPasswordRegistrationOtp(command: { email: string; token: string }): Promise<AuthSession>;
}
