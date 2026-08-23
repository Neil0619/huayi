import type { AuthProvider } from "../auth-provider.js";

export function createFoundationAuthProvider(): AuthProvider {
  return {
    async beginGoogle() {
      return { authState: {}, redirectUrl: "https://accounts.google.test" };
    },
    async beginGoogleLink() {
      throw new Error("Not configured by this fake.");
    },
    async completeCode() {
      throw new Error("Not configured by this fake.");
    },
    async refreshSession() {
      throw new Error("Not configured by this fake.");
    },
    async registerPassword() {
      return {
        authState: {},
        email: "learner@example.com",
        emailConfirmationRequired: true,
        userId: "auth-user-a",
      };
    },
    async setPassword() {
      throw new Error("Not configured by this fake.");
    },
    async signInWithPassword() {
      return {
        email: "learner@example.com",
        refreshToken: "refresh-token",
        userId: "auth-user-a",
      };
    },
    async verifyPasswordRegistrationOtp() {
      return {
        email: "learner@example.com",
        refreshToken: "refresh-token",
        userId: "auth-user-a",
      };
    },
  };
}
