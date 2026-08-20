import type { AuthProvider, AuthState } from "./auth-provider.js";

type Awaitable<Value> = Promise<Value> | Value;

export interface GoogleLinkSessionResult {
  access: "full";
  csrfToken: string;
  expiresAt: Date;
  sessionId: string;
  setCookie: string;
}

export type GoogleLinkContinuation =
  | {
      leaseId: string;
      refreshCiphertext: string;
      stage: "claimed";
      userId: string;
    }
  | {
      leaseId: string;
      protectedProviderState: string;
      stage: "refreshed";
      userId: string;
    };

export interface GoogleLinkRepository {
  claimContinuation(flowId: string, sessionId: string): Awaitable<GoogleLinkContinuation>;
  complete(
    flowId: string,
    sessionId: string,
    providerUserId: string,
    refreshCiphertext: string,
  ): Awaitable<GoogleLinkSessionResult>;
  create(
    sessionId: string,
    origin: string,
    csrfToken: string,
  ): Awaitable<{ expiresAt: Date; flowId: string }>;
  readProviderState(flowId: string, sessionId: string): Awaitable<string>;
  saveProviderStarted(
    flowId: string,
    sessionId: string,
    leaseId: string,
    protectedProviderState: string,
  ): Awaitable<void>;
  saveRefreshed(
    flowId: string,
    sessionId: string,
    leaseId: string,
    userId: string,
    refreshCiphertext: string,
    protectedProviderState: string,
  ): Awaitable<void>;
}

export function createGoogleLinkModule(options: {
  apiOrigin: string;
  auth: AuthProvider;
  protectRefreshToken: (value: string) => string;
  protectTransientAuthState: (value: string) => string;
  repository: GoogleLinkRepository;
  unprotectRefreshToken: (value: string) => string;
  unprotectTransientAuthState: (value: string) => string;
}) {
  return {
    async complete(flowId: string, sessionId: string, code: string) {
      const protectedState = await options.repository.readProviderState(flowId, sessionId);
      const providerSession = await options.auth.completeCode({
        authState: JSON.parse(options.unprotectTransientAuthState(protectedState)) as AuthState,
        code,
      });
      return options.repository.complete(
        flowId,
        sessionId,
        providerSession.userId,
        options.protectRefreshToken(providerSession.refreshToken),
      );
    },

    async continue(flowId: string, sessionId: string) {
      const continuation = await options.repository.claimContinuation(flowId, sessionId);
      let providerState: AuthState;
      if (continuation.stage === "claimed") {
        const refreshed = await options.auth.refreshSession({
          refreshToken: options.unprotectRefreshToken(continuation.refreshCiphertext),
        });
        await options.repository.saveRefreshed(
          flowId,
          sessionId,
          continuation.leaseId,
          refreshed.session.userId,
          options.protectRefreshToken(refreshed.session.refreshToken),
          options.protectTransientAuthState(JSON.stringify(refreshed.authState)),
        );
        providerState = refreshed.authState;
      } else {
        providerState = JSON.parse(
          options.unprotectTransientAuthState(continuation.protectedProviderState),
        ) as AuthState;
      }
      const started = await options.auth.beginGoogleLink({
        authState: providerState,
        redirectTo: `${options.apiOrigin}/v1/account/sign-in-methods/google:callback?flow=${encodeURIComponent(flowId)}`,
      });
      await options.repository.saveProviderStarted(
        flowId,
        sessionId,
        continuation.leaseId,
        options.protectTransientAuthState(JSON.stringify(started.authState)),
      );
      return { redirectUrl: started.redirectUrl };
    },

    create(sessionId: string, origin: string, csrfToken: string) {
      return options.repository.create(sessionId, origin, csrfToken);
    },
  };
}

export type GoogleLinkModule = ReturnType<typeof createGoogleLinkModule>;
