import { createClient } from "@supabase/supabase-js";
import { accountEmailSchema } from "@huayi/cloud-contracts";

import type { AuthProvider, AuthSession, PendingAuthIdentity } from "./auth-provider.js";
import { CloudFault } from "./cloud-fault.js";
import {
  createSupabaseAuthFlow,
  type SupabaseAuthClientFactory,
  type SupabaseAuthStorage,
} from "./supabase-auth-flow.js";

export function createSupabaseAuthProvider(
  createAuthClient: SupabaseAuthClientFactory,
): AuthProvider {
  return {
    async beginGoogleLink(command) {
      const flow = createSupabaseAuthFlow(command.authState);
      const { data, error } = await createAuthClient(flow.storage).auth.linkIdentity({
        options: { redirectTo: command.redirectTo, skipBrowserRedirect: true },
        provider: "google",
      });
      if (error !== null || data.url === null) {
        throw new CloudFault("authentication_required", "Google identity linking could not start.");
      }
      return { authState: flow.state(), redirectUrl: data.url };
    },

    async beginGoogle(command) {
      const flow = createSupabaseAuthFlow();
      const { data, error } = await createAuthClient(flow.storage).auth.signInWithOAuth({
        options: { redirectTo: command.redirectTo, skipBrowserRedirect: true },
        provider: "google",
      });
      if (error !== null || data.url === null) {
        throw new CloudFault("authentication_required", "Google authentication could not start.");
      }
      return { authState: flow.state(), redirectUrl: data.url };
    },

    async completeCode(command): Promise<AuthSession> {
      const flow = createSupabaseAuthFlow(command.authState);
      const { data, error } = await createAuthClient(flow.storage).auth.exchangeCodeForSession(
        command.code,
      );
      if (error !== null || data.session === null || data.user === null) {
        throw new CloudFault("authentication_required", "Google authentication could not finish.");
      }
      return {
        email: accountEmailSchema.parse(data.user.email),
        refreshToken: data.session.refresh_token,
        userId: data.user.id,
      };
    },

    async registerPassword(command): Promise<PendingAuthIdentity> {
      const flow = createSupabaseAuthFlow();
      const { data, error } = await createAuthClient(flow.storage).auth.signUp({
        email: command.email,
        options: { emailRedirectTo: command.redirectTo },
        password: command.password,
      });
      if (error !== null || data.user === null) {
        throw new CloudFault("authentication_required", "Registration could not be completed.");
      }
      return {
        authState: flow.state(),
        email: accountEmailSchema.parse(data.user.email),
        emailConfirmationRequired: data.session === null,
        ...(data.session === null
          ? {}
          : {
              session: {
                email: accountEmailSchema.parse(data.user.email),
                refreshToken: data.session.refresh_token,
                userId: data.user.id,
              },
            }),
        userId: data.user.id,
      };
    },

    async refreshSession(command) {
      const flow = createSupabaseAuthFlow();
      const { data, error } = await createAuthClient(flow.storage).auth.refreshSession({
        refresh_token: command.refreshToken,
      });
      if (error !== null || data.session === null || data.user === null) {
        throw new CloudFault("authentication_required", "The provider session could not refresh.");
      }
      return {
        authState: flow.state(),
        session: {
          email: accountEmailSchema.parse(data.user.email),
          refreshToken: data.session.refresh_token,
          userId: data.user.id,
        },
      };
    },

    async resendPasswordRegistrationOtp(command) {
      const { storage } = createSupabaseAuthFlow();
      const { error } = await createAuthClient(storage).auth.resend({
        email: command.email,
        options: { emailRedirectTo: command.redirectTo },
        type: "signup",
      });
      if (error !== null) {
        throw new CloudFault("authentication_required", "Email verification could not be resent.");
      }
    },

    async setPassword(command) {
      const flow = createSupabaseAuthFlow(command.authState);
      const { data, error } = await createAuthClient(flow.storage).auth.updateUser({
        password: command.password,
      });
      if (error !== null || data.user === null) {
        throw new CloudFault("authentication_required", "The password could not be set.");
      }
      return { authState: flow.state(), userId: data.user.id };
    },

    async signInWithPassword(command): Promise<AuthSession> {
      const { storage } = createSupabaseAuthFlow();
      const { data, error } = await createAuthClient(storage).auth.signInWithPassword(command);
      if (error !== null || data.session === null || data.user === null) {
        throw new CloudFault("authentication_required", "Email or password is invalid.");
      }
      return {
        email: accountEmailSchema.parse(data.user.email),
        refreshToken: data.session.refresh_token,
        userId: data.user.id,
      };
    },

    async verifyPasswordRegistrationOtp(command): Promise<AuthSession> {
      const { storage } = createSupabaseAuthFlow();
      const { data, error } = await createAuthClient(storage).auth.verifyOtp({
        email: command.email,
        token: command.token,
        type: "email",
      });
      if (error !== null || data.session === null || data.user === null) {
        throw new CloudFault("authentication_required", "Email verification could not finish.");
      }
      return {
        email: accountEmailSchema.parse(data.user.email),
        refreshToken: data.session.refresh_token,
        userId: data.user.id,
      };
    },
  };
}

export function createSupabaseAuthClientFactory(options: { publishableKey: string; url: string }) {
  return (storage: SupabaseAuthStorage) =>
    createClient(options.url, options.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
        storage,
      },
    });
}
