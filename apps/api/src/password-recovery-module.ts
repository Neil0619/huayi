import { z } from "zod/v3";

import type { AuthState } from "./auth-provider.js";
import type { PasswordRecoveryProvider } from "./password-recovery-provider.js";

type Awaitable<Value> = Promise<Value> | Value;

export interface RecoveryBrowserSession {
  csrfToken: string;
  expiresAt: Date;
  recoverySessionId: string;
}

export interface RecoverySession {
  csrfToken: string;
  expiresAt: Date;
}

export type PasswordRecoveryCompletion =
  | {
      flowId: string;
      leaseId: string;
      protectedProviderState: string;
      stage: "verified";
    }
  | {
      flowId: string;
      leaseId: string;
      stage: "provider-updated";
    };

export interface PasswordRecoveryRepository {
  callback(
    flowId: string,
    providerUserId: string,
    providerEmail: string,
    protectedProviderState: string,
  ): Awaitable<RecoveryBrowserSession>;
  claimCompletion(
    recoverySessionId: string,
    origin: string,
    csrfToken: string,
  ): Awaitable<PasswordRecoveryCompletion>;
  claimDispatch(): Awaitable<{ email: string; flowId: string; leaseId: string } | undefined>;
  complete(flowId: string, leaseId: string): Awaitable<void>;
  failDispatch(flowId: string, leaseId: string): Awaitable<void>;
  markDispatched(flowId: string, leaseId: string): Awaitable<void>;
  readProviderState(flowId: string): Awaitable<string>;
  readSession(recoverySessionId: string, origin: string): Awaitable<RecoverySession>;
  request(command: { email: string; ipBucket: string }): Awaitable<void>;
  saveProviderUpdated(
    flowId: string,
    leaseId: string,
    providerUserId: string,
    protectedProviderState: string,
  ): Awaitable<void>;
  saveSent(flowId: string, leaseId: string, protectedProviderState: string): Awaitable<void>;
}

const authStateSchema = z.record(z.string());

function parseAuthState(serialized: string): AuthState {
  return authStateSchema.parse(JSON.parse(serialized));
}

export function createPasswordRecoveryModule(options: {
  apiOrigin: string;
  protectTransientAuthState: (value: string) => string;
  provider: PasswordRecoveryProvider;
  repository: PasswordRecoveryRepository;
  unprotectTransientAuthState: (value: string) => string;
}) {
  return {
    async callback(command: { code: string; flowId: string }) {
      const protectedState = await options.repository.readProviderState(command.flowId);
      const identity = await options.provider.exchange({
        authState: parseAuthState(options.unprotectTransientAuthState(protectedState)),
        code: command.code,
      });
      return options.repository.callback(
        command.flowId,
        identity.userId,
        identity.email,
        options.protectTransientAuthState(JSON.stringify(identity.authState)),
      );
    },

    async complete(command: {
      csrfToken: string;
      origin: string;
      password: string;
      recoverySessionId: string;
    }) {
      const continuation = await options.repository.claimCompletion(
        command.recoverySessionId,
        command.origin,
        command.csrfToken,
      );
      if (continuation.stage === "verified") {
        const updated = await options.provider.updatePassword({
          authState: parseAuthState(
            options.unprotectTransientAuthState(continuation.protectedProviderState),
          ),
          password: command.password,
        });
        await options.repository.saveProviderUpdated(
          continuation.flowId,
          continuation.leaseId,
          updated.userId,
          options.protectTransientAuthState(JSON.stringify(updated.authState)),
        );
      }
      await options.repository.complete(continuation.flowId, continuation.leaseId);
    },

    async dispatchNext(): Promise<"failed" | "idle" | "sent"> {
      const dispatch = await options.repository.claimDispatch();
      if (dispatch === undefined) return "idle";
      await options.repository.markDispatched(dispatch.flowId, dispatch.leaseId);
      try {
        const started = await options.provider.begin({
          email: dispatch.email,
          redirectTo: `${options.apiOrigin}/v1/auth/password/recovery/confirm?flow=${encodeURIComponent(dispatch.flowId)}`,
        });
        await options.repository.saveSent(
          dispatch.flowId,
          dispatch.leaseId,
          options.protectTransientAuthState(JSON.stringify(started.authState)),
        );
        return "sent";
      } catch {
        await options.repository.failDispatch(dispatch.flowId, dispatch.leaseId);
        return "failed";
      }
    },

    async readSession(command: { origin: string; recoverySessionId: string }) {
      return options.repository.readSession(command.recoverySessionId, command.origin);
    },

    request(command: { email: string; ipBucket: string }) {
      return options.repository.request(command);
    },
  };
}

export type PasswordRecoveryModule = ReturnType<typeof createPasswordRecoveryModule>;
