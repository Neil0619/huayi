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
/** The bearer and onboarding ticket live only in this instance, never device storage. */
export function createSessionManager(adapter: {
  code(): Promise<string>;
  request(path: string, options?: RequestOptions): Promise<unknown>;
  remember(value: boolean): void;
  remembered(): boolean;
  now?(): number;
}) {
  let token: string | undefined;
  let expiresAt = 0;
  let state: SessionState = { account: null, onboarding: null, epoch: 0 };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: SessionState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const accept = async (session: MiniProgramSession, epoch: number) => {
    const account = miniProgramAccountSchema.parse(
      await adapter.request(miniProgramRoutes.account, { token: session.token }),
    );
    if (state.epoch !== epoch) throw new MiniError("authentication_required");
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
      if (!pending)
        pending = begin().finally(() => {
          pending = undefined;
        });
      await pending;
    },
    async ensure() {
      if (token && expiresAt <= (adapter.now?.() ?? Date.now())) this.invalidate(token);
      if (!token && adapter.remembered()) await this.login();
      if (!token || !state.account) throw new MiniError("authentication_required");
      return token;
    },
    async finish(mode: "independent" | "linked") {
      if (!state.onboarding) throw new MiniError("authentication_required");
      const epoch = state.epoch;
      const result = miniProgramSessionSchema.parse(
        await adapter.request(miniProgramRoutes.onboard, {
          method: "POST",
          data: { ticket: state.onboarding.ticket, mode },
        }),
      );
      await accept(result, epoch);
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
