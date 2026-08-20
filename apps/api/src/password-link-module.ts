import type { AuthProvider, AuthState } from "./auth-provider.js";
import type { SignInMethodRecord } from "./account-sign-in-methods-app.js";
import type { GoogleLinkSessionResult } from "./google-link-module.js";

type Awaitable<Value> = Promise<Value> | Value;

export type PasswordLinkContinuation =
  | {
      flowKey: string;
      leaseId: string;
      refreshCiphertext: string;
      stage: "claimed";
      userId: string;
    }
  | {
      flowKey: string;
      leaseId: string;
      protectedProviderState: string;
      stage: "refreshed";
      userId: string;
    }
  | {
      flowKey: string;
      leaseId: string;
      stage: "provider-updated";
      userId: string;
    };

export interface PasswordLinkRepository {
  claim(sessionId: string, origin: string, csrfToken: string): Awaitable<PasswordLinkContinuation>;
  complete(
    flowKey: string,
    sessionId: string,
    leaseId: string,
  ): Awaitable<{ methods: readonly SignInMethodRecord[]; session: GoogleLinkSessionResult }>;
  saveProviderUpdated(
    flowKey: string,
    sessionId: string,
    leaseId: string,
    providerUserId: string,
  ): Awaitable<void>;
  saveRefreshed(
    flowKey: string,
    sessionId: string,
    leaseId: string,
    providerUserId: string,
    refreshCiphertext: string,
    protectedProviderState: string,
  ): Awaitable<void>;
}

export function createPasswordLinkModule(options: {
  auth: AuthProvider;
  protectRefreshToken: (value: string) => string;
  protectTransientAuthState: (value: string) => string;
  repository: PasswordLinkRepository;
  unprotectRefreshToken: (value: string) => string;
  unprotectTransientAuthState: (value: string) => string;
}) {
  return {
    async execute(sessionId: string, origin: string, csrfToken: string, password: string) {
      const continuation = await options.repository.claim(sessionId, origin, csrfToken);
      let providerState: AuthState | undefined;
      if (continuation.stage === "claimed") {
        const refreshed = await options.auth.refreshSession({
          refreshToken: options.unprotectRefreshToken(continuation.refreshCiphertext),
        });
        await options.repository.saveRefreshed(
          continuation.flowKey,
          sessionId,
          continuation.leaseId,
          refreshed.session.userId,
          options.protectRefreshToken(refreshed.session.refreshToken),
          options.protectTransientAuthState(JSON.stringify(refreshed.authState)),
        );
        providerState = refreshed.authState;
      } else if (continuation.stage === "refreshed") {
        providerState = JSON.parse(
          options.unprotectTransientAuthState(continuation.protectedProviderState),
        ) as AuthState;
      }
      if (providerState !== undefined) {
        const updated = await options.auth.setPassword({ authState: providerState, password });
        await options.repository.saveProviderUpdated(
          continuation.flowKey,
          sessionId,
          continuation.leaseId,
          updated.userId,
        );
      }
      return options.repository.complete(continuation.flowKey, sessionId, continuation.leaseId);
    },
  };
}

export type PasswordLinkModule = ReturnType<typeof createPasswordLinkModule>;
