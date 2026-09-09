import {
  miniProgramAccountSchema,
  miniProgramLoginResponseSchema,
  miniProgramRoutes,
  miniProgramSessionSchema,
  type MiniProgramAccount,
  type MiniProgramLogin,
  type MiniProgramSession,
} from "@huayi/cloud-contracts";
import { MiniError } from "./errors";
import type { RequestOptions } from "./http";

interface SessionState {
  account: MiniProgramAccount | null;
  onboarding: Extract<MiniProgramLogin, { state: "onboarding" }> | null;
  epoch: number;
}
export interface SessionAdapter {
  code(): Promise<string>;
  request(path: string, options?: RequestOptions): Promise<unknown>;
  remember(value: boolean): void;
  remembered(): boolean;
  now?(): number;
}
/** The bearer and onboarding ticket live only in this instance, never device storage. */
export function createSessionManager(adapter: SessionAdapter) {
  let token: string | undefined;
  let expiresAt = 0;
  let state: SessionState = { account: null, onboarding: null, epoch: 0 };
  let pending: { epoch: number; promise: Promise<void> } | undefined;
  let opening:
    | {
        epoch: number;
        ticket: string;
        path: string;
        data: Record<string, unknown>;
        promise: Promise<void>;
      }
    | undefined;
  const listeners = new Set<() => void>();
  const update = (next: SessionState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const current = (epoch: number, ticket?: string) => {
    if (state.epoch !== epoch || (ticket !== undefined && state.onboarding?.ticket !== ticket))
      throw new MiniError("authentication_required");
  };
  const accept = async (session: MiniProgramSession, epoch: number, ticket?: string) => {
    current(epoch, ticket);
    const account = miniProgramAccountSchema.parse(
      await adapter.request(miniProgramRoutes.account, { token: session.token }),
    );
    current(epoch, ticket);
    token = session.token;
    expiresAt = new Date(session.expiresAt).getTime();
    adapter.remember(true);
    update({ account, onboarding: null, epoch: epoch + 1 });
  };
  const begin = async () => {
    const epoch = state.epoch;
    const result = miniProgramLoginResponseSchema.parse(
      await adapter.request(miniProgramRoutes.login, {
        method: "POST",
        data: { code: await adapter.code() },
      }),
    );
    if (epoch !== state.epoch) throw new MiniError("authentication_required");
    if (result.state === "authenticated") await accept(result, epoch);
    else update({ ...state, onboarding: result });
  };
  const complete = async (path: string, data: Record<string, unknown>) => {
    if (!state.onboarding) throw new MiniError("authentication_required");
    const { ticket } = state.onboarding;
    const epoch = state.epoch;
    if (opening?.epoch === epoch && opening.ticket === ticket) {
      if (
        opening.path !== path ||
        Object.keys(data).some((key) => data[key] !== opening?.data[key])
      )
        throw new MiniError("operation_in_progress");
    } else {
      const operation = { epoch, ticket, path, data, promise: Promise.resolve() };
      opening = operation;
      operation.promise = (async () => {
        const result = miniProgramSessionSchema.parse(
          await adapter.request(path, { method: "POST", data: { ...data, ticket } }),
        );
        await accept(result, epoch, ticket);
      })().finally(() => {
        if (opening === operation) opening = undefined;
      });
    }
    await opening.promise;
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    token: () => token,
    async login() {
      if (pending?.epoch !== state.epoch) {
        const operation = { epoch: state.epoch, promise: Promise.resolve() };
        pending = operation;
        operation.promise = begin().finally(() => {
          if (pending === operation) pending = undefined;
        });
      }
      await pending.promise;
    },
    async ensure() {
      if (token && expiresAt <= (adapter.now?.() ?? Date.now())) this.invalidate(token);
      if (!token && adapter.remembered()) await this.login();
      if (!token || !state.account) throw new MiniError("authentication_required");
      return token;
    },
    async finish(mode: "independent" | "linked") {
      await complete(miniProgramRoutes.onboard, { mode });
    },
    async loginAndLink(credentials: { email: string; password: string }) {
      await complete(miniProgramRoutes.loginAndLink, { ...credentials, confirmed: true });
    },
    async reauthenticate() {
      const current = await this.ensure();
      await adapter.request(miniProgramRoutes.reauthenticate, {
        method: "POST",
        token: current,
        data: { code: await adapter.code() },
      });
    },
    invalidate(expectedToken: string) {
      if (token === expectedToken) {
        token = undefined;
        expiresAt = 0;
        update({ account: null, onboarding: null, epoch: state.epoch + 1 });
      }
    },
    clear() {
      token = undefined;
      expiresAt = 0;
      adapter.remember(false);
      update({ account: null, onboarding: null, epoch: state.epoch + 1 });
    },
    async logout() {
      const current = token;
      if (current)
        await adapter.request(miniProgramRoutes.logout, { method: "POST", token: current });
      this.clear();
    },
  };
}
